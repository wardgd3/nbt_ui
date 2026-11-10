# Fight Arena NBT Builder

A single page app for making the game's `.nbt` files. Double-click `index.html`, or run `npm start` and go to http://localhost:5180. It needs no install and works offline. Only the cloud needs `npm start` and a connection.

| Mode | Makes | Game folder | Loaded in game |
| --- | --- | --- | --- |
| Waves | wave save (`FightArenaWaves`) | `wave saves` | Admin page, Waves, Import |
| Colosseum | `fight_arena_colosseum` | `colosseum` | Admin page, Colosseum, or a wave, or Game Setup |
| Temple | `fight_arena_temple` | `temple saves` | Admin page, Temple, Import file |

## Fast use

1. Save opens the Windows Save dialog, where you pick the folder and name the file. Each kind of file reopens where it last saved. To have Open list a game folder, click **Link game folder** at the bottom left and pick the Fight Arena instance folder itself (Chrome and Edge only). With that link, Save opens on the right game folder.
2. Press `/`, type `orc 5`, press Enter. Keep typing the next mob.
3. Press `]` for the next wave or cell, and `Ctrl+S` to save. Your work is kept as a draft if you close the page.

`orc 5`, `5 orc`, `orc x5` and `orc*5` all mean five orcs. Press `?` in the app for every key.

## Map

The Map tab shows Levels 1 to 3 of the Temple from above, with the roof off, in the order players walk them. Scroll to zoom, drag to move, and click a room for its details. A Mob Spawn in the details, or a colosseum's Edit button, opens it in the Temple tab. The Mob Spawns and their mobs come from the Temple file you are working on.

## Conquest

The Conquest tab edits the game's Conquest admin settings: every slider on the in-game Conquest admin page, laid out by the same pages (Vehicles, Rewards, Base, Ordnance, Munitions, Corps, Admin) and sections. The game keeps them in the instance's `config/modern_warfare_ships.json`, which the tab reads and writes directly. That file name is fixed, so this is the one save with no Save dialog.

- **Load** reads the file from the linked game folder. The tab also reads it on its own when you open it, if nothing here is unsaved.
- **Save** (`Ctrl+S`) writes it back. If an admin changed sliders in game since you loaded, it lists those changes and keeps them unless you overwrite them.
- The game reads the file when a world starts and whenever a player joins, so a running world picks a save up on the next join.
- **Import** and **Export** open or download a settings `.json`. Without a linked folder, Save downloads it.
- Each row has a slider, an exact number box, a tick at the default and a reset button. `/` searches every setting, and **Changed** shows only settings off their defaults.
- The right panel lists every change a save would make. Its **Economy** view shows turn income, what each price costs in income time, and how many reactors a shield needs.
- **Free** is kept by the world, not the file, so it stays an in-game switch.

### Guns

The **Guns** page (after Munitions) adjusts every gun the shop sells, by tier. It is not on the in-game page: a Conquest world has no Guns section of its own.

- **Per gun:** damage (the whole shot at the muzzle), range, full-damage range, fire rate, Full Auto rate where the gun has one, and recoil.
- **Tier III guns** also get a Munitions Chest price in gold. Left blank, they cost the Munitions page's share of their shop price.
- A blank box keeps the gun as built; the grey figure shows what that is. **Whole tier** sets damage, fire rate or recoil on every gun in a tier as a percent of each one as built.
- Saved to `config/fight_arena_conquest_guns.json`. Fight Arena reads it in Conquest worlds when a world starts and whenever a player joins (`game/ConquestGuns.java`), over the world's own gun settings.
- The gun list and each gun's own figures come from `config/fight_arena_conquest_guns.catalog.json`, which Fight Arena writes on every start. Load reads the game's copy; `npm run gen:conquest` builds one in.

### Corps

The **Corps** page has the in-game sliders for your corps and the hostile one (how many, health, gun damage, the hostile spawn chance and cap), and under each the corps' men, as the in-game "Edit..." button has them.

- **Per man:** role, main gun and sidearm. Left at "(role's)", he carries his role's own gun for that side; a sidearm can also be none. Add, copy, move or remove men, up to 16. **Copy** makes one side the same as the other, and **Defaults** puts the game's eight back.
- The line above the men adds up the corps' health at its Health setting, and the Economy view sets the two corps side by side.
- Saved to `config/fight_arena_conquest_corps.json`, the file the in-game editor writes. Fight Arena reads it **when Minecraft starts**, so a save reaches the game after a restart. A Save in the in-game editor before then replaces it. If the game changed the file since Load, Save asks first.
- Roles, their health and guns, and the default men are read from FightArenaMod's `CorpsRole.java` and `CorpsConfig.java`; the guns a man may carry come from `src/data.js`.

`src/conquestdata.js` is generated from ModernWarfareMod's `ShipTuning.java`, FightArenaMod's `ConquestAdminScreen.java`, `CorpsRole.java`, `CorpsConfig.java` and lang file, and the gun catalog. After a slider or gun is added in game, run `npm run gen:conquest` (also part of `npm run gen`).

## Cloud

Click **Cloud** and sign in with Google, using `npm start` (sign-in cannot come back to a page opened from disk). Save then also copies the file to the cloud, and Cloud lists, opens and deletes your files of the current kind. The game still reads files from its own folders, so a file opened from the cloud needs a Save to reach the game.

Files are in the `fa_files` table of the D&D DB Supabase project, one row per kind and name, and each user sees only their own. Saving a name that is already there replaces it. The project's Auth URL settings must allow `http://localhost:5180`.

## What gets written

- **Waves:** only waves that differ from the game's table go in the file. On import the game plays every other wave as written, and it replaces any wave edits, wave Colosseums and mob settings the world already has.
- **Colosseum:** the same tags the admin page exports. Castle stats from a file you opened are kept.
- **Temple:** boss, lives, safe room rewards, every Mob Spawn by position, and the three colosseum rooms' gates and rounds. The world keeps the imported Spawns and rooms and puts them back if the Temple is rebuilt. Importing applies to that one world and replaces its boss, lives and rewards, with no backup made first. A Spawn the file does not name keeps what it has. A colosseum room with every gate empty plays its own mix.

## Keeping the data current

`src/data.js` is generated from the mod sources and the Temple Design world. After the wave table, mobs, guns or Temple spawns change, run:

```bash
npm run gen
```

It reads `FightArenaMod`, `DynamicDifficultyMod` and `ModernWarfareMod` from your home folder, and redraws the Map from the blocks in the Temple Design world and the newest `docs/temple/layout_v*.txt`. Close the game first, so the Temple Design region files are not in use.

The Temple's colosseum rooms are read from the same world, by their Colosseum Trap blocks.

`npm test` checks the codec and round-trips your real Colosseum files.
