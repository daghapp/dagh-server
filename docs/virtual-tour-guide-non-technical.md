# Virtual Tour Guide — An Easy-to-Understand Guide
*For presentations, clients, and non-technical audiences.*

> Think of this like a **guided museum visit you can do from your phone** — except
> you never stand in line, and the tour never closes.

---

## 1. What Is It? (The Simple Version)

A **Virtual Tour Guide** is like having a friendly guide walk you through a
famous building, a heritage site, or a whole city — **without being there in
person**.

Imagine you open the app, tap a place you want to visit, and you're instantly
"standing inside" it. You can:

- **Look around** at a 360° view, like turning your head in real life.
- **Click a spot** and read or hear its story.
- **Follow a route** the guide sets out for you, step by step.
- **Pick up where you left off** — the app remembers your progress.

---

## 2. Who Is It For?

| Who | What they get |
| --- | --- |
| **Tourists** | Explore before they travel, or revisit afterward. |
| **On-site visitors** | An interactive guide on their own phone — no booking, no guide fee. |
| **Schools & students** | Virtual class trips to places they can't reach. |
| **Museums, castles, heritage sites** | Share their story with the whole world, 24/7. |
| **Tour companies** | Extra value to bundle with their existing tour packages. |

---

## 3. What Does It Do? (In Everyday Words)

1. **Build the tour** — The team behind the scenes puts a location's stops
   (rooms, monuments, viewpoints) in order and adds photos, videos, and audio.
2. **Publish it** — The tour goes live for everyone to browse.
3. **Take the tour** — A visitor opens it, moves from stop to stop, looks at
   360° views, and listens to the story.
4. **Track progress** — The app quietly remembers which stops you've visited,
   tick them off, and celebrates when you've completed the whole tour.
5. **Live guided tour (bonus)** — A real guide can push everyone along at the
   same time, like a live broadcast, so groups experience it together.

---

## 4. Why Do We Need a Backend System? (In Plain Words)

Your **phone app** is only the "front" of the experience — what people see and
touch. But someone needs to:

- Keep every tour, stop, and story **safely stored** and organized.
- Make sure **the right people** (admins) can add or edit tours, while visitors
  can only view them.
- **Serve the media** (panoramas, videos, audio) quickly to thousands of people
  at once.
- **Remember each visitor's progress** even after they close the app.
- **Find things by name** ("the tower", "the dungeon") or **near a location**.

That "behind the scenes" system is what the backend does — think of it as the
**engine under the hood** of the car that is the tour app.

---

## 5. How Does It Work? (A Simple Walkthrough)

Like a **library**:

- **The shelf** = the database, storing every tour and its stops.
- **The librarian** = the backend, who fetches the right tour, hands over the
  media, and keeps a record of your visit.
- **The shelves you can touch** = the phone/computer app you actually use.
- **The card file** = a separate, safe area that only staff can update — tour
  creators add new tours here; visitors never see the editing tools.

```
Visitor app ──asks for a tour──► Backend ──looks it up──► Database
     ▲                              │                        │
     │                              │ Media (360°, audio)    ▼
     └────────── tour + media ◄─────┴────── Cloud storage ──┘
```

- The visitor only ever gets "published" tours — anything in the editing stage
  stays invisible until it's approved and released.

---

## 6. What Makes This Different or Special?

- **No app store queues** — a tour is a few clicks to publish, like posting a
  story.
- **Works everywhere** — on-site or remote, phone or desktop.
- **Progress that feels rewarding** — like a task list that checks itself off.
- **Live group tours** — a human guide can lead many people at once, just like
  music streaming but for touring.
- **Built on what we already have** — this project already handles tours,
  bookings, payments, and users, so the new feature fits right in with no
  duplication.

---

## 7. What Do We Need to Build It?

| Thing | Plain-talk description |
| --- | --- |
| **Storage for tours** | A well-organized filing cabinet for tours, stops, and progress records. |
| **Media storage** | A cloud vault for big images, 360° views, videos, and audio. |
| **The tour screen** | The page/stops you see in the app. |
| **Admin controls** | Private tools for staff to create and update tours. |
| **Progress tracking** | The quiet memory of where each visitor stopped. |
| **Live guide mode** | Real-time push for guided group tours. |

---

## 8. What Happens When Someone Uses It? (Example)

> Ama, a student in Kumasi, wants to "visit" Cape Coast Castle.
>
> 1. She opens the app and sees the castle's virtual tour.
> 2. She taps *Start* and arrives at the entrance — a 360° view, with a short
>    audio story.
> 3. She explores room by room; the app shows a checklist filling up.
> 4. She leaves halfway and returns the next day — *she resumes right where she
>    left off*.
> 5. A week later, a group of her classmates tours together, guided live by a
>    real guide they follow on screen.

---

## 9. The Building Plan (Simple Steps)

1. Set up the storage (filing cabinet) and publish the first sample tour.
2. Let visitors view tours and move from stop to stop.
3. Let staff create and edit tours from a safe admin area.
4. Add media uploads (360°, video, audio).
5. Add progress tracking and resume-where-you-left-off.
6. Add search and search-by-location.
7. Add the live guided-tour feature.
8. Test everything thoroughly, then go live.

Each step is like building a room, then furnishing it — you can use the tour
hallway long before every room is decorated.

---

## 10. Three Things the Audience Should Remember

1. **It's a tour you can take from anywhere** — like a museum that comes to you.
2. **It's already a natural fit** — we're bolting it onto an existing travel
   platform, not starting from scratch.
3. **It scales from "nice extra" to "core value"** — it helps tourists,
   enriches heritage sites, and gives tour operators something new to sell.

---

*Questions? The technical version of this document is in
`docs/virtual-tour-guide.md`.*