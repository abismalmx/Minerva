## Commit messages

A commit is signed by the project and by nobody else.

1. **The author is `Minerva Project <dev@minerva.invalid>`.** No other name in
   `Author` or `Committer`.
2. **No `Co-Authored-By:` trailer**, and no other trailer naming a person or a
   tool. A commit is one author.
3. **No mention of Claude, Anthropic, or any other assistant in the subject or
   the body.** The message describes the change and the mechanism, the same as
   any other commit in this repository.
4. The subject line stays in English and states the change; the body explains
   why, and what was left out and why.

A commit that breaks this rule is rewritten: amend the message, then
`git push --force-with-lease` the branch.
