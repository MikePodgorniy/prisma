# @prisma/adapter-mongodb

Experimental driver adapter for using the official `mongodb` package with Prisma.

This adapter is not officially supported and is provided as an example. It manages MongoDB transactions using `AsyncLocalStorage` so that queries run inside a transaction automatically use the correct session.
