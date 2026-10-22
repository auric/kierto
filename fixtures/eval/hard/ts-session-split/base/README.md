# account-service

Login, logout, and the account pages of the shop.

## Sessions

- A session ends after 30 minutes without a request, and 12 hours after the login at the latest.
- A user holds up to 10 sessions. A new login ends the least recently used one beyond that.
- A password change ends every other session of the user and gives the current session a new ID.
- The session cookie holds `<id>.<signature>`. `SESSION_KEYS` lists the signing keys: the first one signs, all of them verify.

The sessions live in the memory of each process. The load balancer pins each user to one process.
