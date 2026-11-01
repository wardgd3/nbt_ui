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
