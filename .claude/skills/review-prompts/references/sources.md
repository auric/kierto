# Checklist sources

The checklist items in `src/server/review/languages.ts` are original ASD-STE100 text. They copy no licensed text. Use these sources to check an item or to add one.

Status of the rule IDs: UNVERIFIED. Nobody checked the IDs below against the current source text. Check an ID at the URL before you cite it in code, a test, or a commit.

## C++

- C++ Core Guidelines: https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines
- SEI CERT C++ Coding Standard: https://wiki.sei.cmu.edu/confluence/display/cplusplus
- GCC "Options Controlling the Kind of Output" (file suffixes for `EXT`): https://gcc.gnu.org/onlinedocs/gcc/Overall-Options.html

| Item | Candidate IDs (unverified) |
|---|---|
| lifetime | Core Guidelines F.43, ES.65, lifetime profile; CERT EXP54-CPP |
| ownership | Core Guidelines R.1, R.11, I.11 |
| exceptions | Core Guidelines E.6, C.36, C.66, C.85; CERT DCL57-CPP, ERR56-CPP |
| ub | CERT EXP53-CPP, CTR50-CPP, INT32-C |
| integers | Core Guidelines ES.46, ES.100 to ES.107; CERT INT30-C, INT31-C |
| iterators | CERT CTR51-CPP, EXP54-CPP |
| move | Core Guidelines ES.56, F.48; CERT EXP63-CPP |
| copy | Core Guidelines C.21, C.67 |
| inheritance | Core Guidelines C.35, C.67, ES.63; CERT OOP52-CPP |
| races, locks, threads, atomics | Core Guidelines CP.2, CP.20, CP.21, CP.22, CP.25, CP.42, CP.100 to CP.111; CERT CON50-CPP to CON56-CPP |
| templates | Core Guidelines T.10, T.47, T.69 |
| const | Core Guidelines Con.1 to Con.5 |
| abi | Core Guidelines I.26 |
| windows, windows-types | Microsoft Learn, CreateFile and GetLastError pages; Windows data types page (LLP64) |

## C

- SEI CERT C Coding Standard: https://wiki.sei.cmu.edu/confluence/display/c

| Item | Candidate IDs (unverified) |
|---|---|
| memory | MEM30-C, MEM31-C, MEM34-C |
| bounds | ARR30-C, ARR32-C, ARR38-C |
| strings | STR31-C, STR32-C |
| integers | INT30-C, INT32-C, INT02-C, MEM07-C |
| pointers | EXP34-C, EXP39-C, EXP40-C |
| errors | ERR33-C, ERR30-C |
| races | CON32-C, CON43-C, SIG30-C, SIG31-C |
| format | FIO30-C, FIO47-C |
| macros | PRE01-C, PRE02-C, PRE31-C |

## Python

- Language reference: https://docs.python.org/3/reference/
- Programming FAQ (mutable defaults, closures in loops): https://docs.python.org/3/faq/programming.html
- Compound statements (finally and return): https://docs.python.org/3/reference/compound_stmts.html#the-try-statement
- asyncio (blocking calls, task references): https://docs.python.org/3/library/asyncio-dev.html and https://docs.python.org/3/library/asyncio-task.html
- subprocess (shell=True): https://docs.python.org/3/library/subprocess.html#security-considerations
- pickle (untrusted data): https://docs.python.org/3/library/pickle.html
- sqlite3 (placeholders): https://docs.python.org/3/library/sqlite3.html#sqlite3-placeholders
- tempfile (mktemp): https://docs.python.org/3/library/tempfile.html
- PyYAML (yaml.load and SafeLoader): https://pyyaml.org/wiki/PyYAMLDocumentation
- Bandit plugin list: https://bandit.readthedocs.io/en/latest/plugins/index.html

| Item | Candidate Bandit IDs (unverified) |
|---|---|
| injection | B602, B603, B605 |
| deserialization | B301, B302, B506 |
| sql | B608 |
| unsafe-calls | B307, B102, B306, B501 |
| exceptions | B110 |
