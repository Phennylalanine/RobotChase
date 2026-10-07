# Robo Chase

A classroom quiz game. Students join on their own devices with a 6‑digit code, answer together, and every correct answer helps the whole crew run from the robot to the escape pod.

- **Students go to:** `https://YOUR-NAME.github.io/robo-chase/`
- **Teacher opens:** `https://YOUR-NAME.github.io/robo-chase/host.html`

## Try it first (no setup)

Open `host.html` in a browser, click **Try a sample quiz**, then **Open game room**, then **Add 5 test players** and **Start**. Open the student page (`index.html`) in another tab of the same browser to play along. This is *demo mode*: it only works between tabs on one computer until you finish the Firebase step below.

> Tip: some browsers block pages opened straight from a folder. If nothing happens, try it after uploading to GitHub (step 1).

## Step 1 — Put it on GitHub Pages (free)

1. Sign in to GitHub and create a **new public repository** called `robo-chase`.
2. Click **Add file → Upload files** and drag in *everything* from this folder (including the `lib` folder). Click **Commit changes**.
3. Go to **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute your site is live at `https://YOUR-NAME.github.io/robo-chase/`.

## Step 2 — Connect Firebase (free) so students can join from their own devices

GitHub Pages only serves files, so the game uses Firebase's free plan to pass answers between devices live.

1. Go to <https://console.firebase.google.com> and **create a project** (Google Analytics is not needed).
2. **Authentication → Get started → Sign-in method → Anonymous → Enable.** (Students never sign in; this just gives each device an ID.)
3. **Authentication → Settings → Authorized domains → Add domain:** `YOUR-NAME.github.io`
4. **Realtime Database → Create database.** Pick a location near you (for Japan, *asia-southeast1* is closest) and start in **locked mode**.
5. In the database's **Rules** tab, replace everything with the contents of `database.rules.json` and click **Publish**. (If you set this up with an earlier version, paste the new rules again.)
6. **Project settings (⚙) → General → Your apps → Web (`</>`)**. Register an app (no hosting needed). Copy the values from the `firebaseConfig` it shows into `firebase-config.js`. Make sure `databaseURL` is filled in.
7. Upload the changed `firebase-config.js` to GitHub (**Add file → Upload files**, it will replace the old one).

The yellow "Demo mode" bar disappears when it's connected.

> The Firebase `apiKey` is meant to be public; the database rules are what keep games safe. Each room can only be controlled by the teacher's browser that opened it, and each student can only write their own name and answers.

## Making quizzes

Use a spreadsheet with these columns (the same layout as your existing file):

| Question | Answer 1 | Answer 2 | Answer 3 | Answer 4 | Time limit (sec) | Correct answer(s) | Image |
|---|---|---|---|---|---|---|---|
| CAT | Yes | No | | | 20 | 2 | dog.jpg |
| Pick the even numbers | 3 | 4 | 7 | 10 | 20 | 2,4 | |

- 2 to 6 answers per question. Leave extra answer columns empty.
- More than one correct answer: write them like `2,4`. Any of them counts as correct.
- **Image** is optional.
- You can drop the Excel file (`.xlsx`) straight in, or save as CSV. In Excel choose **File → Save As → CSV UTF-8** for Japanese text (plain CSV also works).

### Pictures

On the teacher page you can:

- **Drop pictures together with the quiz file.** A picture attaches itself when its file name matches the question (`cat.jpg` → CAT) or the name in the Image column. Any others fill in the remaining questions in file-name order.
- **Click the picture box** next to any question to add or change its picture.

Pictures are shrunk automatically so they load fast on student devices. They show on the big screen and on each student's device.

Your last quiz is remembered in that browser. **Save quiz with pictures** downloads a `.robochase.json` file you can drop back in later or on another computer.

## How the game works

The game is a three-chapter story. Each chapter is a self-paced quiz chase followed by a Missile Dodge bonus game, and the next chapter starts automatically after each bonus.

1. **Escape the space station.** Run to the escape pods → Bonus 1.
2. **Crash landing.** A cutscene shows the pod crashing onto a strange planet with the robot following. The crew collects 5 mechanical parts to fix the pod, then blasts off → Bonus 2.
3. **Out of fuel.** The engine sputters and the pod drifts down onto an icy moon. The crew grabs 5 fuel cells and blasts off for home → Bonus 3, with moving asteroids.
4. **Ending.** The crew flies home while the robot drifts off into deep space.

**The chase (self-paced)**
- Every student answers on their own device at their own pace, in their own shuffled order. Questions repeat in a new order if they run out.
- Every student needs **5 correct answers** per chapter. The projector shows each student's progress as five dots, with the students who still need help listed first.
- The crew moves forward as the class gets closer to everyone having 5, picking up parts or fuel cells along the way. The chapter ends when every student has their 5.
- In chapters 2 and 3, each correct answer shows the student the part or fuel they found, in Japanese (for example 「ギアを みつけた！」).
- Students who already have 5 keep answering for points while the rest of the crew catches up.
- The robot moves forward with time. If it catches the crew, a shield zaps it back (3 shields per chapter). With no shields left, a catch costs a life.
- Each question's time limit from your file still applies. Faster correct answers earn more points, with a small bonus for streaks.
- **Start bonus now** skips ahead if someone is stuck. Clicking a student's name removes them (for example, a student who left).

**Bonus: Missile Dodge**
- Every student flies their own pod on their device: tap or drag where to go, or use the arrow keys on a laptop. On an upright phone the arena turns sideways to fill the screen.
- A green safe zone appears with a countdown. When it hits zero, missiles strike everywhere outside the zone.
- Each bonus has 3 rounds with one missile strike each (about 30 seconds in total), and gets harder as it goes:
  - Round 1 and 2 add more asteroids to fly around.
  - **Round 3 has two safe zones with exactly enough spots for everyone**, split as evenly as possible (15 pods → 7 and 8, 16 pods → 8 and 8). Spots go to whoever gets there first. The zones count up as they fill, and anyone in a full zone has to race to the other one. **The asteroids move in Round 3** and can bump pods out of a zone.
  - Bonus 2 starts with asteroids from the first round. In **Bonus 3 the asteroids move in every round**, getting faster each time.
- Anyone caught outside a zone (or without a spot) costs the crew a life and sits out the rest of that bonus. They're back in for the next chapter.
- Every dodged strike is worth +100 points. If the crew runs out of lives, the game ends.
- After each bonus there's a 10-second countdown to the next chapter, with buttons to continue right away or finish the game there.

**Crew lives:** choose 1, 2 or 3 lives per student in the waiting room. With one strike per round, a class typically loses around a quarter of its lives in each bonus, so 1 per student is tough but possible. Choose 2 per student if you want most classes to make it home.

To change the bonus difficulty, edit the `BONUSES` list at the top of `bonus.js`. Setting `waves` higher gives a round more missile strikes. To change the story text, edit `CHAPTERS` in `common.js`.

## Free plan limits

Firebase's free plan allows 100 devices connected at once and 10 GB of downloads a month, which is plenty for a class. Pictures are the biggest part: each device downloads each picture once, so a 20‑question quiz with pictures for 35 students uses roughly 50–70 MB per game. Each bonus game adds only a few MB.

## Privacy

Students only type a nickname. Encourage first names or made‑up names. Game data is deleted when you click **Choose another quiz**; you can also clear old rooms any time from the Realtime Database page in Firebase.

## Files

| File | What it is |
|---|---|
| `index.html`, `student.js` | Student join and play screen |
| `host.html`, `host.js` | Teacher screen |
| `common.js`, `style.css` | Shared artwork, rules and styles |
| `bonus.js` | The Missile Dodge bonus game |
| `firebase-config.js` | Your Firebase settings |
| `database.rules.json` | Security rules to paste into Firebase |
| `lib/` | CSV, Excel and QR code readers |
