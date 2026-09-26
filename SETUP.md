# Frontend setup

    npm create vite@latest frontend -- --template react
    cd frontend
    npm i react-router-dom zustand
    npm i -D tailwindcss @tailwindcss/vite

Then drop these files in, overwriting what Vite generated:

    src/App.jsx
    src/api.js
    src/store.js
    src/index.css
    src/components/BudgetBar.jsx
    src/screens/ImportScreen.jsx
    src/screens/ReviewScreen.jsx
    src/screens/AislesScreen.jsx
    src/screens/ARScreen.jsx
    vite.config.js
    .env

Leave src/main.jsx as Vite made it. Delete src/App.css.

Run:

    npm run dev

Open the Network URL it prints on your phone, same wifi.
Backend must be running with --host 0.0.0.0, and .env must point at
your laptop's LAN IP (not localhost) for the phone to reach it.
