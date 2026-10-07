import unittest
from narova_tts.pronunciation import apply, sentence_pairs, expected
from narova_tts.speech_check import compare_pronunciation

class Pronunciation(unittest.TestCase):
    def test_literal_overlap_unicode_nonrecursive(self):
        mapping={'CLAUDE.md':'Claude Em Dee','Claude':'Clawd','محمد':'Muhammad','😀':'Smile'}
        self.assertEqual(apply('CLAUDE.md, Claude; xClaude Claude2 Claude_ Claudé claude محمد محمدی 😀.',mapping)[0], 'Claude Em Dee, Clawd; xClaude Claude2 Claude_ Claudé claude Muhammad محمدی Smile.')
    def test_split_before_replacement_and_external_precedence(self):
        t={'text':'Read CLAUDE.md. Continue.','synthesisText':'[whisper] CLAUDE.md! Continue!'}
        m={'CLAUDE.md':'Claude. Em Dee'}
        self.assertEqual(sentence_pairs(t,'pockettts',m),[('Read Claude. Em Dee.','Read CLAUDE.md.'),('Continue.','Continue.')])
        self.assertEqual(sentence_pairs(t,'external',m)[0][0],'[whisper] Claude. Em Dee!')
        warnings=[];t['synthesisText']='Different.'
        self.assertEqual(sentence_pairs(t,'external',m,warnings.append),sentence_pairs(t,'piper',m));self.assertEqual(len(warnings),1)
    def test_only_applied_pairs_are_spelling_equivalences(self):
        t={'text':'Read CLAUDE.md.'}; spoken,pairs=expected(t,{'CLAUDE.md':'Claude Em Dee','unrelated':'wrong'})
        for transcript in ['Read Claude MD.','Read Claude Em Dee.']:
            self.assertEqual(compare_pronunciation(spoken,transcript,pairs)['status'],'match')
        for transcript in ['Read flawed MD.','Read Claude.','Read wrong.','']:
            self.assertEqual(compare_pronunciation(spoken,transcript,pairs)['status'],'mismatch')
        self.assertEqual(compare_pronunciation('One hundred, two.','One hundred two.',pairs)['status'],'mismatch')
        self.assertEqual(expected({'text':'One.  Two.'},{'absent':'x'})[0],'One.  Two.')

    def test_review_regressions_selected_input_spoken_prefix_numbers_and_joined_aliases(self):
        t={'text':'Read NASA.','synthesisText':'Read Nasa.'}
        self.assertEqual(expected(t,{'Nasa':'En Ay Ess Ay'},'external'),('Read En Ay Ess Ay.',[('Nasa','En Ay Ess Ay')]))
        self.assertEqual(expected(t,{'NASA':'En Ay Ess Ay'},'external'),('Read NASA.',[]))
        for clean, mapping, transcript, status in [
            ('Read NASA.',{'NASA':'NASA agency'},'Read NASA agency.','match'),
            ('Read NASA.',{'NASA':'NASA agency'},'Read NASA agency. Extra','mismatch'),
            ('twenty, A.',{'A':'one'},'twenty, A.','match'),
            ('twenty A.',{'A':'one'},'twenty, A.','mismatch'),
            ('twenty, one.',{'one':'one'},'twenty, one.','match'),
            ('Read CLAUDE.md.',{'CLAUDE.md':'Claude Em Dee'},'Read ClaudeMD.','match'),
            ('Read CLAUDE.md.',{'CLAUDE.md':'Claude Em Dee'},'Read Claude M D.','match'),
            ('Read CLAUDE.md.',{'CLAUDE.md':'Claude Em Dee'},'Read flawed MD.','mismatch'),
        ]:
            spoken,pairs=expected({'text':clean},mapping)
            self.assertEqual(compare_pronunciation(spoken,transcript,pairs)['status'],status,(clean,transcript))

    def test_joined_brand_with_number_word_keeps_existing_comparison_and_numeric_boundaries(self):
        spoken,pairs=expected({'text':'Read OneDrive.'},{'OneDrive':'Microsoft cloud drive'})
        self.assertEqual(compare_pronunciation(spoken,'Read One Drive.',pairs)['status'],'match')
        self.assertEqual(compare_pronunciation(spoken,'Read One wrong Drive.',pairs)['status'],'mismatch')
        spoken,pairs=expected({'text':'Read twentyone.'},{'twentyone':'brand'})
        self.assertEqual(compare_pronunciation(spoken,'Read twenty, one.',pairs)['status'],'mismatch')
