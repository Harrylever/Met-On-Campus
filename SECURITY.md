# Security

Met On Campus holds students' private conversations, so we take security reports seriously and are grateful for them.

## Reporting a problem

**Please do not open a public issue or pull request for a security problem.**

Email **hello@metoncampus.xyz** with the subject "Security", and include:

- what the problem is and where (the page, endpoint or file),
- the steps to reproduce it, or a short proof of concept,
- what someone could do with it (for example "read another student's messages").

Please do not access, change or keep other people's data while testing: use your own test accounts, and stop as soon as you have shown the problem.

## What to expect

We aim to reply within a few days, tell you whether we can reproduce it, and keep you updated until it is fixed. We are happy to credit you once it is fixed, if you would like that.

## In scope

The API (`apps/api`), the student app (`apps/web`), the staff platform (`apps/platform`), the marketing site (`apps/marketing`) and the database schema and migrations. Examples we especially care about: reading or changing another student's data, getting around who can see whom (modes, blocking, campus boundaries), signing in without a valid university email or as someone else, getting into the staff platform, and leaking personal data through logs or notifications.

## Not in scope

Denial-of-service by sheer traffic, social engineering of maintainers, and problems in third-party services (Railway, Vercel, Resend) that we cannot fix ourselves.
