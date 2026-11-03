# Sartor Meals

A small, phone-first meal planner for the Sartor family: week plan with Abendbrot and prep day, "Was hättest du lieber?" questions, a shopping list that copies cleanly into WhatsApp or Bring!, recipes, and fridge/freezer bites for quick lunches.

- **App:** static HTML/CSS/JS, served by GitHub Pages. No build step.
- **Data:** Firebase Firestore, read and written over its REST API (no SDK). Each tab is one document at `h/<household>/tabs/<Tab>` holding its rows as JSON; writes use an update-time precondition and retry, so phones editing at once don't overwrite each other. `seed.json` holds the starter tabs; the app writes them on first connect.
- **Access:** the household id is a long random secret. The Firestore rules (kept in the Firebase console, not here) open only that one path. No keys or secrets are stored in this repo.
- **Setup link:** `https://iamsartor.github.io/sartor-meals/#setup?p=<firebase project id>&h=<household id>`, shared privately. Without it the app runs on the example data, saved only on that device.
- **Design:** colors, type and spacing from Montage, the design system by Wanted Lab (MIT), with color blocking.
