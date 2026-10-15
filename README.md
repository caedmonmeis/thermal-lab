# Ridgeline Thermal Lab (Netlify version)

## What's in here
- public/index.html: the simulator page
- netlify/functions/read-terrain.mjs: the private server piece that sends screenshots to Claude
- netlify.toml, package.json, package-lock.json: settings that tell Netlify how to deploy it

Drag and drop deploys do NOT run server functions. Deploy from GitHub (steps below) so the auto scan works.

## 1. Get a Claude API key
1. Go to console.anthropic.com and sign up.
2. Add a payment method and buy a small amount of credit (for example $10).
3. Under Settings > Limits, set a monthly spend limit so costs can't run away.
4. Under API Keys, create a key and copy it. You will only see it once.

Rough cost: about 3 to 5 cents per scan with the default model.

## 2. Put the files on GitHub
1. Sign in at github.com and create a new private repository (for example `thermal-lab`).
2. Click "uploading an existing file" and drag in everything from this folder (both folders and all files), then Commit.

## 3. Connect it to Netlify
- To keep your current site URL: open your site in Netlify > Site configuration > Build & deploy > Link repository, and pick the GitHub repo.
- Or make a new site: Add new site > Import an existing project > GitHub > pick the repo.
- Leave the build command empty. The publish folder (`public`) comes from netlify.toml.

## 4. Add your settings
Site configuration > Environment variables > Add a variable:

| Name | Value | Required |
|---|---|---|
| ANTHROPIC_API_KEY | your key from step 1 (mark it as secret) | Yes |
| APP_PASSCODE | a word you give your friends | Recommended |
| DAILY_SCANS_PER_VISITOR | number of scans per person per day (default 10, 0 = no cap) | No |
| ANTHROPIC_MODEL | leave blank to use claude-sonnet-5-5 | No |

Then go to Deploys > Trigger deploy so the new settings take effect.

## 5. Test it
Open the site, choose "My map (upload screenshot)", and upload an onX screenshot. If you set a passcode, the page asks for it once and remembers it on that device.

## Built-in protection
- Your API key stays on Netlify and is never sent to the browser.
- The server writes the instructions to Claude, so visitors can only use it to read maps.
- Each visitor gets at most 3 scans a minute and the daily cap you set.
