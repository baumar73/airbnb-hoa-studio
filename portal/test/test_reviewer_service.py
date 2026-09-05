import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('service',pathlib.Path(__file__).parents[1]/'scripts/reviewer_service.py')
service=importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

class ServiceContract(unittest.TestCase):
    def test_os_releases_lock_after_abrupt_process_death(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp).resolve()/'isla-reviewer'
            code="import pathlib,sys,time; sys.path.insert(0,sys.argv[1]); from reviewer_service import runner_lock; lock=runner_lock(pathlib.Path(sys.argv[2])); lock.__enter__(); print('ready',flush=True); time.sleep(30)"
            proc=subprocess.Popen([sys.executable,'-c',code,str(pathlib.Path(service.__file__).parent),str(root)],stdout=subprocess.PIPE,text=True)
            try:
                self.assertEqual(proc.stdout.readline().strip(),'ready')
                proc.kill();proc.wait(timeout=5)
                with service.runner_lock(root): pass
            finally:
                if proc.poll() is None: proc.kill();proc.wait(timeout=5)
                proc.stdout.close()

    def test_private_configuration_refuses_symlinks_and_permissive_files(self):
        with tempfile.TemporaryDirectory() as temp:
            path=pathlib.Path(temp)/'config.json'
            path.write_text(json.dumps({'ISLA_PORTAL_ORIGIN':'https://example.com','ISLA_REVIEW_API_TOKEN':'x'*40}))
            path.chmod(0o644)
            with self.assertRaises(RuntimeError): service.private_config(path)
            path.chmod(0o600)
            self.assertEqual(service.private_config(path)['ISLA_REVIEW_RELIABILITY'],'yes')
            link=pathlib.Path(temp)/'link';link.symlink_to(path)
            with self.assertRaises(OSError): service.private_config(link)

    def test_lock_survives_process_crash_without_stale_pid_recovery(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp).resolve()/'isla-reviewer'
            with service.runner_lock(root):
                with self.assertRaises(BlockingIOError):
                    with service.runner_lock(root): pass
            with service.runner_lock(root): pass
            with self.assertRaises(RuntimeError):
                with service.runner_lock(pathlib.Path(temp)): pass

    def test_restart_removes_only_private_review_scratch(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp).resolve()/'isla-reviewer'
            with service.runner_lock(root):
                scratch=service.clean_scratch(root)
                stale=scratch/'isla-ai-synthetic';stale.mkdir(mode=0o700);(stale/'private.pdf').write_bytes(b'synthetic')
                keep=root/'keep.txt';keep.write_text('keep')
                outside=pathlib.Path(temp)/'outside';outside.mkdir()
                link=scratch/'isla-ai-symlink';link.symlink_to(outside)
                service.clean_scratch(root)
                self.assertFalse(stale.exists());self.assertTrue(keep.exists());self.assertTrue(outside.exists());self.assertTrue(link.is_symlink())

    def test_runs_immediately_then_waits_and_retries_without_logging_errors(self):
        waits=[]
        def wait(seconds):
            waits.append(seconds)
            return len(waits)==3
        with patch.object(service,'print') as log:
            from unittest.mock import Mock
            job=Mock(side_effect=[RuntimeError('private secret'),1,0])
            service.run_loop(job,wait)
            self.assertEqual(job.call_count,3);self.assertEqual(waits,[300,600,300])
            self.assertNotIn('private secret',str(log.call_args_list))

if __name__=='__main__': unittest.main()
