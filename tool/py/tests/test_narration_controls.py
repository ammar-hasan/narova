import unittest
from narova_tts.pipeline import sentence_cache_key, derived_seed
from narova_tts.word_selector import select_word_index

class TestContextIdentity(unittest.TestCase):
    def test_context_changes_identity_and_seed_but_no_context_preserves_existing_key(self):
        args = ('external', 'voice', 'Now.', 1.0)
        plain = sentence_cache_key(*args)
        first = sentence_cache_key(*args, context={'previousText': 'Before.', 'nextText': 'After.'})
        second = sentence_cache_key(*args, context={'nextText': 'Changed.', 'previousText': 'Before.'})
        self.assertNotEqual(plain, first)
        self.assertNotEqual(first, second)
        self.assertNotEqual(derived_seed(first), derived_seed(second))
        self.assertEqual(first, sentence_cache_key(*args, context={'nextText': 'After.', 'previousText': 'Before.'}))
        self.assertEqual(plain, sentence_cache_key(*args, context=None))

    def test_literal_word_selector_matches_unicode_and_rejects_ambiguity(self):
        tokens = ['Hello,', 'hello!', 'سلام۔']
        self.assertEqual(select_word_index(tokens, {'text': 'HELLO', 'occurrence': 1}), 1)
        self.assertEqual(select_word_index(tokens, {'text': 'سلام'}), 2)
        for selector in ({'text': 'hello'}, {'text': 'missing'}, {'text': 'hello', 'occurrence': -1}, {'text': ''}, True):
            with self.assertRaises(ValueError): select_word_index(tokens, selector)
