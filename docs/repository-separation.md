# Telegram and mobile repository separation

Muze now has two independent products:

- This repository (`Muze`) contains the Telegram bot only.
- `Muze-App` contains the React Native application and its Node.js API.

The repositories must use different MongoDB database names, credentials,
deployment services, environment files, user identities, discussions, message
delivery, notifications, and release workflows. No synchronization job or
cross-platform account linking is part of either product.

The local mobile repository currently lives at:

`C:\Users\shaja\Documents\Work\Muze-App`

New mobile work belongs there. New Telegram work belongs here. Shared product
ideas may be reimplemented independently, but code and database records must
not be copied automatically between production systems.
