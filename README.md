# Sartor Meals

A small, phone-first meal planner for the Sartor family: week plan with Abendbrot and prep day, "Was hättest du lieber?" questions, a shopping list that copies cleanly into WhatsApp or Bring!, recipes, and fridge/freezer bites for quick lunches.

- **App:** static HTML/CSS/JS, served by GitHub Pages. No build step.
- **Data:** a Google Sheet ("Sartor Meals") in Michael's Drive. `seed.json` holds the starter tabs; the app creates them on first connect.
- **Connector:** `apps-script/Code.gs`, pasted once into the Sheet's Apps Script and deployed as a web app. It only runs generic row operations (`ensure`, `append`, `update`, `replace`, `delete`), so it never needs changes.
- **Setup link:** `https://iamsartor.github.io/sartor-meals/#setup?u=<web app URL>&k=<key>`. The first key used claims the connector. Without a setup link the app runs on the example data, saved only on that device.
- **Design:** colors, type and spacing from Montage, the design system by Wanted Lab (MIT), with color blocking.
