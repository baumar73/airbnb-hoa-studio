import importlib.util
import pathlib
import unittest

SPEC = importlib.util.spec_from_file_location(
    'guest_scope', pathlib.Path(__file__).parents[1] / 'scripts/gbrain_guest_scope.py')
scope = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scope)


class ScopeTests(unittest.TestCase):
    def test_client_output_is_parsed_without_preserving_transcript(self):
        raw = 'Client ID: gbrain_cl_abc\nClient Secret: gbrain_cs_def\n'
        self.assertEqual(scope.parse_client(raw), ('gbrain_cl_abc', 'gbrain_cs_def'))

    def test_missing_or_duplicate_credentials_fail_closed(self):
        for raw in ('', 'Client ID: gbrain_cl_x',
                    'Client ID: gbrain_cl_x\nClient ID: gbrain_cl_y\nClient Secret: gbrain_cs_z'):
            with self.assertRaises(ValueError):
                scope.parse_client(raw)

    def test_identity_must_match_every_grant_axis(self):
        good = {'transport': 'oauth', 'client_id': 'client',
                'source_id': scope.SOURCE, 'federated_read': [scope.SOURCE],
                'scopes': ['read', 'write'], 'expires_at': 123}
        scope.check_identity(good, 'client')
        for key, value in [('source_id', 'default'), ('transport', 'legacy'),
                           ('federated_read', [scope.SOURCE, 'default']),
                           ('scopes', ['read', 'write', 'admin']), ('expires_at', None)]:
            with self.assertRaises(ValueError):
                scope.check_identity({**good, key: value}, 'client')

    def test_denial_is_not_just_a_missing_page_or_network_error(self):
        self.assertTrue(scope.is_denied({'isError': True, 'content': [
            {'type': 'text', 'text': '{"error":"permission_denied"}'}]}))
        for result in ({'isError': False}, {'error': {'code': -32000}},
                       {'isError': True, 'content': [{'type': 'text', 'text': 'page_not_found'}]}):
            self.assertFalse(scope.is_denied(result))

    def test_token_request_may_be_clamped_but_never_elevated(self):
        scope.check_token_grant({'scope':'read write', 'expires_in':300})
        for token in ({'scope':'read write admin','expires_in':300},
                      {'scope':'read write','expires_in':3600}, {},
                      {'scope':'','expires_in':300}):
            with self.assertRaises(ValueError):
                scope.check_token_grant(token)


if __name__ == '__main__':
    unittest.main()
