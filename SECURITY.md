# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes, in
particular:

- the **Weenect credentials**: the e-mail and password are stored by Gladys in
  the integration configuration and only sent to `apiv4.weenect.com` over
  HTTPS, to log in;
- the **session token** the Weenect API returns, kept in
  `/data/weenect-session.json` (mode 0600) next to a hash of the e-mail — never
  the e-mail nor the password;
- the **positions** of the trackers: never written to the logs, and never
  published to Gladys in the "Zones only" mode;
- the network: the container only talks to `apiv4.weenect.com` (HTTPS) and to
  Gladys; the map links point to `www.openstreetmap.org` and are only opened by
  the user's browser.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Weenect cloud, apps and trackers (report those to Weenect).
