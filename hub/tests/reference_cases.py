#!/usr/bin/env python3
"""Generate repeatable Unicode and boundary cases using the protocol oracle."""
import json
import random
import runpy
import sys

reference = runpy.run_path(sys.argv[1])
compose = reference['compose_answer']
label = reference['ANSWER_LABEL']
rng = random.Random(921255)
cases = [
    'a' * 248 + '\n' + 'b' * 249 + '\n' + 'c' * 250,
    'a' * 124 + ' ' + '🙂' * 80 + ' tail',
    '👨‍👩‍👧‍👦' * 180,
    'e\u0301' * 500,
    '🙂' * 130 + '\n' + 'x' * 650 + ' end',
    '\u001c  words\u2007\n next\u2029',
    'first\r\n  ' + label + ' \r\nlast',
    '\n'.join(f'{i}. ' + 'x' * 126 for i in range(20)),
]
fragments = ['a', '0123456789', ' ', '\n', '\r\n', '🙂', '🚒', 'e\u0301', '\t', '\u00a0']
for _ in range(80):
    cases.append(''.join(rng.choice(fragments) for _ in range(rng.randrange(80, 700))))
json.dump([{'output': value, 'messages': compose(value)} for value in cases], sys.stdout, ensure_ascii=False)
