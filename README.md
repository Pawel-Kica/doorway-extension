# Doorway

A free, open source Chrome new tab: a big clock, "Good morning Alex." and a beautiful photo behind it. Use your own photos or pick from 100 nature photos that come with it. It works offline and needs no account.

More at [pawelkica.com/doorway](https://pawelkica.com/doorway). For apps on your Mac there's [Doorway Desktop](https://github.com/Pawel-Kica/doorway-desktop). Omakase style, so fork it or open an issue if you'd like something changed.

![New tab](docs/screenshots/1-new-tab.jpg)

## Install

1. Clone the repo:
   ```
   git clone https://github.com/Pawel-Kica/doorway-extension.git
   ```
2. In Chrome, go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension` folder.
4. Open a new tab and you're done!

If another new tab extension is installed, turn it off, because only one extension can take over the new tab.

## How to use

Click the sliders icon in the bottom-left corner.

**General:** show or hide the clock and greeting, 24-hour clock, your name in the greeting. Double-click the name on the page to edit it there too.

<img src="docs/screenshots/2-general.png" alt="General settings" width="380">

**Photos > My Photos:** click + Add Photo or drop images anywhere on the page. Hover a photo to edit its location or delete it.

<img src="docs/screenshots/3-my-photos.png" alt="My photos" width="380">

**Photos > Settings:** pick where photos come from, how often they change, and how they fit the screen.

<img src="docs/screenshots/4-photo-settings.png" alt="Photo settings" width="380">

**Night mode:** from 20:00 the photo goes away and it's just the clock on black. From 22:00 the greeting says "Go to sleep". Turn either off or change the hours here. Click a preview to watch the switch on the page.

<img src="docs/screenshots/5-night-mode.png" alt="Night mode" width="380">

Click the location text at the bottom left to favorite the photo or skip to the next one.

## Details

- Night mode ends at 4:00 by default, the same hour "Good morning" starts.
- Blocked websites (Settings > Distractions): type a site and it opens a black "blocked" page instead, subdomains included. `bbc.com` covers the whole site, `bbc.com/news` only that part. This is why the extension asks for access to all sites, it only uses it to redirect the ones on your lists.
- Think twice (Settings > Distractions): a site on this list first asks "Do you really need it?". Yes opens it right away in that tab until you close the tab. What you saved for the site shows in a todo list in the top right corner (+ adds more, a click on "Todos" folds it). Once everything is checked, "I'm done!" takes you back to the new tab. The same list shows under the question: + adds a note for next time, a click checks one off. Save keeps the link you came from on it. No takes you back to the new tab. Keys work too: y Yes, s Save, n or Enter No. Pass on a site's row lets every tab open it without asking for 15, 30, 60 or any number of minutes, the pill on the site counts down ("End 12:34", a click ends it). When it ends, tabs already on the site stay, the next one asks again.
- Super lock (Settings > Distractions): every day between two hours you pick, Think twice sites don't open at all. The page says "youtube.com is super locked until 10:00." with the site's list (you can still add to it) and OK. When it starts, passes end and open tabs on those sites go back to that page. While it's on, the bottom left of the new tab says so, and its settings and the Think twice list can't be changed.
- Feeds: Nature photos, My photos and Favorites, turn on any mix and photos come from all of them. If they are all empty you get Nature photos.
- Change photo: every new tab, every hour, every 6-12 hours (default, random) or every day (at 4:00). No repeats until the enabled feeds run out.
- Photo fit: Fill screen crops the photo, Fit to screen shows all of it over a blurred copy. Auto (default) fits when filling would crop more than 35%.
- Your photos are shrunk to 2560px and saved in this Chrome profile (IndexedDB). Removing the extension deletes them.
- Nature photos are from Wikimedia Commons, credits in `extension/photos/stock.json`.

## Tests

Headless Playwright Chromium with a temp profile, never your real Chrome:

```
NODE_PATH=$(npm root -g) node tests/e2e.cjs
```

Screenshots land in `/tmp/doorway-shots/`.

## License

MIT for the code, see [LICENSE](LICENSE). Nature photos keep their Wikimedia Commons licenses, listed in `extension/photos/stock.json`.

The photos I use myself are in `my-photos/`, grab any you like. They aren't covered by the MIT license and belong to their photographers (the Bugatti Tourbillon shots are Bugatti press photos, the Starship launch is SpaceX's).
