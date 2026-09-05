"""Offline runner contracts: no mail, production API, PDF generation or model calls."""
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import base64
import hashlib
import tempfile
import types
import subprocess
import sys
import unittest
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('runner', pathlib.Path(__file__).parents[1] / 'scripts/run_local_ai_review.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

def synthetic_package():
    data=b'%PDF synthetic archive test, not an HOA template'
    return {'packageId':'package-v1','packageHash':'manifest-hash','documents':[{'reviewFilename':'01-guest-registration.pdf','size':len(data),'sha256':hashlib.sha256(data).hexdigest(),'base64':base64.b64encode(data).decode()}]}


class RunnerContract(unittest.TestCase):
    def test_standalone_startup_redacts_transport_configuration_errors(self):
        env={**os.environ,'ISLA_PORTAL_ORIGIN':'http://PRIVATE-CONFIG.example.test'}
        result=subprocess.run([sys.executable,str(pathlib.Path(runner.__file__))],env=env,capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,1)
        self.assertNotIn('Traceback',result.stderr)
        self.assertNotIn('PRIVATE-CONFIG',result.stdout+result.stderr)

    def test_hybrid_claim_and_lost_ack_retry_do_not_repeat_model(self):
        case={'id':'synthetic','reviewHash':'hash','reviewContextHash':'ctx','guestName':'PRIVATE GUEST'}
        calls=[]
        def api(path,payload=None):
            calls.append((path,payload))
            if path.endswith('candidates'): return {'protocol':2,'cases':[case]}
            if path.endswith('claim'): return {'token':'lease-token'}
            if path.endswith('package'): return synthetic_package()
            if path.endswith('result') and sum(p.endswith('result') for p,_ in calls)==1: raise TimeoutError('private failure')
            return {'ok':True}
        with patch.object(runner,'api_request',side_effect=api), patch.object(runner,'local_ai_review',return_value={'status':'green','findings':[],'summary':'PRIVATE SUMMARY','confidence':.9}) as model, contextlib.redirect_stdout(io.StringIO()) as log:
            self.assertEqual(runner.main(),0)
            model.assert_called_once()
            results=[payload for path,payload in calls if path.endswith('result')]
            self.assertEqual(len(results),2);self.assertEqual(results[0],results[1])
            self.assertEqual(results[0]['claimToken'],'lease-token')
            self.assertNotIn('PRIVATE',log.getvalue())
            self.assertEqual(calls[-1],('/admin/review/heartbeat',{'state':'completed'}))

    def test_failure_of_one_case_does_not_starve_the_next_and_reports_no_private_error(self):
        cases=[{'id':str(i),'reviewHash':'hash','reviewContextHash':'ctx'} for i in range(2)]
        calls=[]
        def api(path,payload=None):
            calls.append((path,payload))
            if path.endswith('candidates'): return {'protocol':2,'cases':cases}
            if path.endswith('claim'): return {'token':'lease-token'}
            if path.endswith('package'): return synthetic_package()
            return {'ok':True}
        with patch.object(runner,'api_request',side_effect=api), patch.object(runner,'local_ai_review',side_effect=[RuntimeError('private guest/token'),{'status':'red','findings':['private finding'],'summary':'test','confidence':.9}]) as model, contextlib.redirect_stdout(io.StringIO()) as log:
            self.assertEqual(runner.main(),1);self.assertEqual(model.call_count,2)
            self.assertTrue(any(path.endswith('failure') for path,_ in calls))
            self.assertNotIn('private',log.getvalue())
            self.assertEqual(calls[-1],('/admin/review/heartbeat',{'state':'failed'}))

    def test_hybrid_configuration_refuses_an_old_server(self):
        with patch.dict(os.environ,{'ISLA_REVIEW_RELIABILITY':'yes'}), patch.object(runner,'api_request',return_value={'cases':[]}), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError): runner.main()

    def test_empty_queue_never_invokes_generator_or_model(self):
        with patch.object(runner, 'api_request', return_value={'cases': []}) as api, patch.object(runner.subprocess, 'run') as process:
            self.assertEqual(runner.main(), 0)
            api.assert_called_once_with('/admin/review/candidates')
            process.assert_not_called()

    def test_current_result_only_and_private_temporary_files(self):
        case = {'id': 'synthetic', 'reviewHash': 'content-hash', 'reviewContextHash': 'context-hash'}
        paths = []
        def review(original, files):
            paths.extend(files)
            for path in paths:
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(paths[0].read_bytes(),base64.b64decode(synthetic_package()['documents'][0]['base64']))
            return {'status':'green','findings':[],'summary':'test','confidence':.9}
        with patch.object(runner, 'api_request', side_effect=[{'cases': [case]}, synthetic_package(), {'ok': True}]) as api, patch.object(runner.subprocess, 'run') as process, patch.object(runner, 'local_ai_review', side_effect=review), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(runner.main(), 0)
            path, payload = api.call_args.args
            self.assertEqual(path, '/admin/review/result')
            self.assertEqual(set(payload), {'id', 'reviewHash', 'reviewContextHash', 'packageId', 'packageHash', 'report'})
            self.assertEqual(payload['reviewContextHash'], 'context-hash')
            self.assertEqual(payload['packageId'],'package-v1')
            process.assert_not_called()
        self.assertTrue(all(not path.exists() for path in paths))

    def test_stale_result_is_discarded_without_retry(self):
        case = {'id': 'synthetic', 'reviewHash': 'old', 'reviewContextHash': 'old-context'}
        conflict = urllib.error.HTTPError('https://portal.example.test', 409, 'conflict', {}, None)
        with patch.object(runner, 'api_request', side_effect=[{'cases': [case]}, synthetic_package(), conflict]) as api, patch.object(runner, 'local_ai_review', return_value={'status':'green','findings':[],'summary':'test','confidence':.9}), contextlib.redirect_stdout(io.StringIO()) as log:
            self.assertEqual(runner.main(), 0)
            self.assertEqual(api.call_count, 3)
            self.assertIn('verworfen', log.getvalue())

    def test_invalid_origins_fail_before_any_network(self):
        for origin in ['http://portal.example.test', 'https://user:secret@portal.example.test', 'https://portal.example.test/path', 'https://portal.example.test?secret=x']:
            with self.subTest(origin=origin), patch.dict(os.environ, {'ISLA_PORTAL_ORIGIN': origin}), patch.object(runner.urllib.request, 'build_opener') as network:
                with self.assertRaises(RuntimeError):
                    runner.api_request('/admin/review/candidates')
                network.assert_not_called()

    def test_redirect_does_not_forward_authorization(self):
        self.assertIsNone(runner.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.example.test'))

    def test_archive_rejects_path_traversal_and_changed_bytes(self):
        for field,value in [('reviewFilename','../../escaped.pdf'),('sha256','incorrect-hash')]:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                package=synthetic_package()
                package['documents'][0][field]=value
                with self.assertRaises(RuntimeError):
                    runner.write_review_package(package,pathlib.Path(directory)/'bundle')

    def test_model_has_no_file_tools_or_review_token_and_receives_data_on_stdin(self):
        path=pathlib.Path('/synthetic/01-guest-registration.pdf')
        with patch.object(runner,'inspect_pdf',return_value=('synthetic applicant text',[],{'file':path.name,'pages':1})), patch.dict(os.environ,{'ISLA_REVIEW_API_TOKEN':'synthetic-secret'}), patch.object(runner.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout='g|90|OK')) as process:
            self.assertEqual(runner.local_ai_review({'pathType':'guest-registration'},[path])['status'],'green')
            args=process.call_args.args[0];kwargs=process.call_args.kwargs
            self.assertEqual(args[args.index('--toolsets')+1],'none')
            self.assertIn('--safe-mode',args)
            self.assertNotIn('synthetic applicant text',' '.join(args))
            self.assertIn('synthetic applicant text',kwargs['input'])
            self.assertNotIn('ISLA_REVIEW_API_TOKEN',kwargs['env'])


if __name__ == '__main__':
    unittest.main()
