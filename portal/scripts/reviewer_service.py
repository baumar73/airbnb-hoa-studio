#!/usr/bin/env python3
"""Restartable POSIX reviewer supervisor. Prepared only; never installs itself.

Run under the existing host's approved service manager with absolute paths.
Configuration is private JSON, not shell code. No portal-admin credential needed.
"""
import argparse
import contextlib
import fcntl
import json
import os
import pathlib
import shutil
import signal
import stat
import threading


def private_config(path):
    path=pathlib.Path(path)
    if not path.is_absolute():
        raise RuntimeError('Configuration path must be absolute')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd) as file:
        info=os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600:
            raise RuntimeError('Configuration must be an owner-only regular file (0600)')
        config=json.load(file)
    allowed={'ISLA_PORTAL_ORIGIN','ISLA_REVIEW_API_TOKEN','ISLA_AI_MODEL','PATH'}
    if not isinstance(config,dict) or set(config)-allowed or not all(isinstance(v,str) for v in config.values()):
        raise RuntimeError('Invalid reviewer configuration')
    if len(config.get('ISLA_REVIEW_API_TOKEN',''))<32 or not config.get('ISLA_PORTAL_ORIGIN'):
        raise RuntimeError('Missing dedicated reviewer configuration')
    return {**config,'ISLA_REVIEW_RELIABILITY':'yes'}


def private_directory(path):
    path.mkdir(mode=0o700,parents=True,exist_ok=True)
    info=path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o700:
        raise RuntimeError('Reviewer directory must be owned by this account with mode 0700')


@contextlib.contextmanager
def runner_lock(root):
    root=pathlib.Path(root)
    if not root.is_absolute() or root.name!='isla-reviewer' or root.resolve()!=root:
        raise RuntimeError('Use a dedicated absolute isla-reviewer directory without symlinks')
    private_directory(root)
    fd=os.open(root/'runner.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'a') as file:
        fcntl.flock(file,fcntl.LOCK_EX|fcntl.LOCK_NB)
        yield
        # The OS also releases this lock on process death or power loss. No
        # stale PID deletion, lock-file removal or local job database needed.


def clean_scratch(root):
    scratch=root/'scratch'
    private_directory(scratch)
    # Caller holds the exclusive supervisor lock. Only this service's private
    # job directories are candidates; never scan /tmp or another application's data.
    for child in scratch.iterdir():
        info=child.lstat()
        if child.name.startswith('isla-ai-') and stat.S_ISDIR(info.st_mode) and info.st_uid==os.getuid() and stat.S_IMODE(info.st_mode)==0o700:
            shutil.rmtree(child)
    return scratch


def run_loop(job,wait):
    failures=0
    while True:
        try:
            result=job()
        except Exception:
            result=1
            print('Reviewer cycle unavailable; retry scheduled.',flush=True)
        failures=0 if result==0 else min(failures+1,4)
        if wait(300 if not failures else min(1800,300*2**(failures-1))):
            return


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',required=True,type=pathlib.Path)
    parser.add_argument('--state-dir',required=True,type=pathlib.Path)
    args=parser.parse_args()
    os.umask(0o077)
    config=private_config(args.config)
    # Load before importing the reviewer so its model setting uses this config.
    os.environ.update(config)
    from run_local_ai_review import main as review
    stopped=threading.Event()
    def stop(signum,frame):
        stopped.set()
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,stop)
    signal.signal(signal.SIGINT,stop)
    try:
        with runner_lock(args.state_dir):
            os.environ['ISLA_REVIEW_SCRATCH']=str(clean_scratch(args.state_dir))
            run_loop(review,stopped.wait)
    except KeyboardInterrupt:
        return 0
    except BlockingIOError:
        print('Reviewer already running.',flush=True)
        return 0
    return 0


if __name__=='__main__':
    try:
        raise SystemExit(main())
    except Exception:
        # Never put URLs, transport exceptions, applicant text or credentials in
        # unattended service-manager logs. Details remain in the protected portal.
        print('Reviewer startup failed; check private configuration and permissions.',flush=True)
        raise SystemExit(1)
