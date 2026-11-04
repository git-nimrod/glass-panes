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
| A picture or video won't upload | Pictures can be up to 25 MB, videos up to 100 MB, and SVG isn't allowed. You also need to be an administrator. |
| The video is black on a mirror | Shipped panes include no video, so upload one first. Then look at `/status` on the mirror. |
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
