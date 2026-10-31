# Fight Arena NBT Builder

A single page app for making the game's `.nbt` files. Double-click `index.html`, or run `npm start` and go to http://localhost:5180. It needs no install and works offline. Only the cloud needs `npm start` and a connection.

| Mode | Makes | Game folder | Loaded in game |
| --- | --- | --- | --- |
| Waves | wave save (`FightArenaWaves`) | `wave saves` | Admin page, Waves, Import |
| Colosseum | `fight_arena_colosseum` | `colosseum` | Admin page, Colosseum, or a wave, or Game Setup |
| Temple | `fight_arena_temple` | `temple` | Admin page, Temple, Import file |

## Fast use

1. Click **Link game folder** at the bottom left and pick the Fight Arena instance folder. This works in Chrome and Edge. Save then writes straight into the right game folder, and Open lists what is there. Without it, files go wherever the browser saves them.
2. Press `/`, type `orc 5`, press Enter. Keep typing the next mob.
3. Press `]` for the next wave or cell, and `Ctrl+S` to save. Your work is kept as a draft if you close the page.

`orc 5`, `5 orc`, `orc x5` and `orc*5` all mean five orcs. Press `?` in the app for every key.

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

It reads `FightArenaMod`, `DynamicDifficultyMod` and `ModernWarfareMod` from your home folder. Close the game first, so the Temple Design region files are not in use.

The Temple's colosseum rooms are read from the same world, by their Colosseum Trap blocks.

`npm test` checks the codec and round-trips your real Colosseum files.
