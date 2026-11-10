# Troubleshooting and FAQ

Problem with the mirror itself (adb, the launch screen, presence)? Start with the table at the end of [mirror-app/install-app-lululemon-studio.md](mirror-app/install-app-lululemon-studio.md).

## Quick fixes

| What you see | What to try |
|---|---|
| No **Glass Panes** in the sidebar | Add the integration first (**Settings > Devices & services > Add integration**). The sidebar item is for administrators only, so check you're signed in as one. Then reload the browser page. |
| The builder is blank | Hard-reload the page (Ctrl+F5). Open the browser console (F12) and, if you see a red error, include it in an issue. Also check the Home Assistant log for `glass_panes`. |
| The builder looks like an old version after an update | If the release notes say Python changed, restart Home Assistant. Then hard-reload once. |
| A widget says "No entity" or shows an empty state | Nothing is bound to it yet. Edit the pane and pick one of your own entities. Shipped panes never contain entity ids. |
| The sports or news widget is empty | Sports only shows live games, games that just finished, tonight's game, or games in the next 7 days. The widget prints a short note saying why it's empty. Turn on **Preview with sample data** to see what it looks like. |
| The slideshow says "Folder not found" or "No photos in this folder" | The folder is written relative to a Home Assistant media folder (for example `photos/family` for `/media/photos/family`; `local/photos/family` means the same). Network storage you added in Home Assistant (Settings, System, Storage) appears under `/media`. Only JPEG, PNG and WebP files directly inside the folder are used (not sub-folders), and file names starting with a dot are skipped. |
| The first photos take a moment to appear | Each photo is shrunk once the first time it is needed, then kept in a cache (`glass_panes/cache` in your Home Assistant config folder, trimmed to 300 MB). A big folder of large originals needs a minute to warm up. |
| A camera or photo shows "Idle", "On" or a time instead of the picture | Bind the entity that holds the picture: a `camera.*` or `image.*` entity. Integrations such as Immich add several entities to one device (a slideshow switch, a "next image" button and an image entity); only the image entity has the photo. Picking it in the builder suggests the Image widget; a value widget bound to it also shows the picture. |
| An image or camera entity shows nothing | The entity must be an `image` or `camera` entity that gives a picture right now. The picture is asked for again every few seconds (camera) or when the entity changes (image). Check the entity in Home Assistant's own picture card first. |
| A picture or video won't upload | Pictures can be up to 25 MB, videos up to 100 MB, and SVG isn't allowed. You also need to be an administrator. |
| The video is black on a mirror | Shipped panes include no video, so upload one first. Then look at `/status` on the mirror. |
| The mirror shows a plain white screen | Open `http://<mirror address>:8099/status` and read `seconds_since_heartbeat`. `-1` means the address or display id is wrong (the id is **lowercase**; copy it with **Open this display's player**). A small number means the player runs and the pane has nothing to draw: pick **House** or **Looping video** under **Displays > Showing**. Full table: [step 7c of the app guide](mirror-app/install-app-lululemon-studio.md#7c-what-you-should-see). |
| A mirror command says "hostname contains invalid characters", or complains about `<` | A placeholder still has its angle brackets. Replace the whole `<...>`, including the brackets. |
| `adb` or `fastboot` shows no device | The cable first: many micro-USB cables only charge (several people tried four or five). Then another USB port, and the driver ([Part 1, step 2](mirror-app/install-android-lululemon-studio.md#2-get-windows-to-see-fastboot)). |
| The sign-in link says "unauthorized" | The login was revoked or replaced. Deleting the integration revokes every login too. Press **Set up login** again. Also remember a display login only works from your home network. |
| The display shows the wrong pane | The display's `select` entity decides what it shows, and an automation may be setting it. Check that automation's traces. |
| You can't delete a pane | A display is showing it. Switch the display to another pane first. |
| An agent's save is refused | The error lists the reasons: off the canvas, duplicate widget ids, wrong option types and so on. Call `glass_panes.get_schema` to see the rules. |
| Text is cut off at the edge of a mirror | The mirror's frame can hide the outer 40 px. The **Mirror view** marks the safe zone, so keep important content inside it. |
| A "Show when" widget never appears | An entity condition needs an entity chosen (**Choose entity...**). Until you pick one, the widget stays off on purpose. |

## FAQ

**Is my data sent anywhere?**
No. Everything stays in your Home Assistant. A mirror's camera presence sends a few numbers to Home Assistant and never any pictures.

**Why admins only?**
The builder changes what screens show and creates logins. Displays themselves use a limited login instead.

**Which languages?**
English only, for now.

**Can I limit a display to certain entities?**
Not with Home Assistant today. A display's login is an ordinary non-admin user, and Home Assistant can't restrict those to certain entities.

**Where do I report bugs or ask questions?**
On [GitHub Issues](https://github.com/git-nimrod/glass-panes/issues/new/choose). Never paste tokens or webhook addresses. A Discord for beta testers is being set up, and its link will go in the README.
