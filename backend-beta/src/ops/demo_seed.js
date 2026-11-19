import { randomBytes } from "node:crypto";
import session from "express-session";
import { create_app } from "../app.js";
import { create_v1_stack } from "../api_v1/stack.js";
import { create_password_hasher } from "../features/users/password_hasher.js";
import { campus_to_utc, slot_by_id, utc_to_campus_date } from "../shared/slots.js";

// Demo data for a fresh deployment: 5 clubs, a venue administrator, a
// president, two committee members and three members per club, six students
// with no club, and 25 events spread over the three weeks around today.
//
// Everything after the accounts goes through the real v1 API, so events,
// bookings, sign-offs, registrations, waitlists, join requests, check-ins,
// notifications and audit rows look exactly as if people had used the app.
// Past events are created on a simulated clock that is moved back in time, and
// people register, queue, quit, rejoin and get promoted over several days
// (the activity report reads all of that from the participation history).
//
// Every account shares one password (DEMO_ACCOUNT_PASSWORD; compose.yaml
// defaults it to the documented demo password). All addresses use the
// reserved .example domain.

const DOMAIN = "clubspace.example";
const ORIGIN = "http://demo-seed.invalid";
const DAY_MS = 86_400_000;

const CLUBS = [
  { key: "photo", name: "Photography Society", description: "A campus community for students interested in photography.", tags: ["Beginner friendly", "Outdoor"] },
  { key: "film", name: "Film Society", description: "Film screenings and discussions for university students.", tags: ["Screening", "Workshop"] },
  { key: "debate", name: "Debate Club", description: "Practice debates and public-speaking workshops.", tags: ["BP format", "Social"] },
  { key: "hiking", name: "Hiking Club", description: "Weekend hikes across Hong Kong's country parks, for every fitness level.", tags: ["Beginner friendly", "Advanced"] },
  { key: "robotics", name: "Robotics Lab", description: "Build, code and race small robots with other makers.", tags: ["Hands-on", "Competition"] },
];

const VENUES = [
  { name: "Lok Yew Hall", location: "Main Campus", capacity: 80, description: "A flexible hall for student activities." },
  { name: "Main Building Room 230", location: "Main Building", capacity: 35, description: "A seminar room in the Main Building." },
  { name: "GoldenScene Cinema", location: "Kennedy Town", capacity: 120, description: "A cinema for screenings and talks." },
  { name: "Student Union Activity Room", location: "Student Union Building", capacity: 40, description: "A carpeted room with movable tables and a projector." },
  { name: "Sports Centre Studio", location: "Sports Centre", capacity: 30, description: "A studio for briefings, warm-ups and small workshops." },
];
const V = { hall: "Lok Yew Hall", room: "Main Building Room 230", cinema: "GoldenScene Cinema", union: "Student Union Activity Room", studio: "Sports Centre Studio" };

// Fictional names (no real people): president, committee x2, members x3 per club.
const PEOPLE = {
  photo: ["Chan Hiu Tung", "Ho Wing Lam", "Kwok Chi Yeung", "Lee Sum Yi", "Yuen Pak Hei", "So Hoi Lam"],
  film: ["Leung Ka Ho", "Tang Wai Man", "Chow Ching Yan", "Siu Lok Tin", "Kwan Hei Tung", "Lo Yan Ting"],
  debate: ["Wong Tsz Yan", "Au Yeung Chun", "Fong Sze Wing", "Choi Ka Lok", "Hung Mei Yee", "Tam Ho Ching"],
  hiking: ["Cheung Yuk Ching", "Lui Tsz Hin", "Ma Wing Yan", "Kong Chun Hei", "Yau Hiu Lam", "Wan Ka Yee"],
  robotics: ["Ng Chun Wai", "Pang Hoi Yin", "Ip Ka Chun", "Chu Wing Sze", "Shum Tsz Lok", "Liu Yan Kiu"],
};
const STUDENTS = ["Lau Wing Sze", "Tse Ho Yin", "Yip Sin Yi", "Fung Kai Chung", "Mak Hoi Ying", "Poon Chi Hang"];

// Extra plain memberships, so a few people belong to two clubs.
const EXTRA_MEMBERS = [["member1.photo", "film"], ["member2.hiking", "robotics"], ["member3.debate", "photo"], ["student4", "hiking"]];
// Club join requests left for the committee to review.
const CLUB_REQUESTS = [["student1", "photo"], ["student2", "robotics"], ["student3", "hiking"]];

// day: offset from today (Hong Kong). reg: how many people register.
// plan: who does what and when, as [hours after publish, person, op] steps:
// "+" registers (or asks to join, members-only), "-" leaves (or withdraws a
// pending request), "ok" has the committee accept that person's request. The
// person is an index into the event's registrants, and every step lands
// before the event starts and no later than today. Without a plan, people
// register a day or so apart (members-only: accepted two hours later, up to
// `accept` of them).
// attend: past events only, how many check in (the last one is marked by the
// committee, the rest use the code). accept: members-only events, how many
// requests the committee accepts (the rest stay pending).
// flow: published (default), past, president_signoff, venue_pending,
// publish_signoff, cancelled.
const EVENTS = [
  // Past, with attendance for the reports.
  { club: "photo", venue: V.hall, day: -18, slot: "evening", title: "Golden Hour Photo Walk", capacity: 12, tags: ["arts", "social"], club_tags: ["Outdoor", "Beginner friendly"], reg: 14, attend: 5, flow: "past",
    // Fills at 12, two people queue, then leaves promote them and one person leaves and rejoins.
    plan: [[2, 0, "+"], [5, 1, "+"], [9, 2, "+"], [14, 3, "+"], [20, 4, "+"], [26, 5, "+"], [31, 6, "+"], [38, 7, "+"], [44, 8, "+"], [49, 9, "+"], [55, 10, "+"], [61, 11, "+"],
      [66, 12, "+"], [72, 13, "+"], [80, 3, "-"], [90, 8, "-"], [100, 3, "+"], [104, 5, "-"]],
    description: "Meet at Lok Yew Hall, then walk to the Centennial Campus terraces to shoot the sunset. Bring any camera, phones welcome.\n\nWhat happens:\n- First 20 minutes: meet at the hall entrance, quick tips on light and framing.\n- Middle hour: a slow walk to the terraces with stops for portraits and skyline shots.\n- Last 30 minutes: swap favourite frames and pick one to share.\n\nWho it's for: anyone, including complete beginners. Wear comfortable shoes and bring a water bottle and a light jacket. Free to join, 12 places, so join the waitlist if it fills up. Please check in with the committee at the meeting point; if the weather turns, we shelter in the hall and run the tips session indoors." },
  { club: "film", venue: V.cinema, day: -14, slot: "evening", title: "Hong Kong New Wave Screening", capacity: 10, tags: ["arts", "culture"], club_tags: ["Screening"], reg: 12, attend: 6, flow: "past",
    plan: [[3, 0, "+"], [8, 1, "+"], [12, 2, "+"], [19, 3, "+"], [27, 4, "+"], [33, 5, "+"], [40, 6, "+"], [52, 7, "+"], [58, 8, "+"], [64, 9, "+"],
      [70, 10, "+"], [76, 11, "+"], [84, 2, "-"], [92, 6, "-"], [100, 2, "+"], [108, 4, "-"]],
    description: "A screening of an early 1980s Hong Kong New Wave feature, followed by a short discussion led by the committee.\n\nWhat happens:\n- Doors open 15 minutes before the film, and seats are first come, first served among registered guests.\n- The feature plays in full, with English subtitles.\n- Afterwards, about 15 minutes of relaxed discussion on style, city and soundtrack.\n\nWho it's for: anyone curious about local cinema; no film background needed. Bring a light layer because the cinema runs cold, and silence your phone. Free entry. This is a small preview showing with 10 seats, and the committee will check names at the door. If it is full you can join the waitlist, and seats go to the queue as people drop out." },
  { club: "debate", venue: V.room, day: -12, slot: "afternoon", title: "Intro to British Parliamentary Debate", capacity: 8, tags: ["academic"], club_tags: ["BP format"], reg: 10, attend: 4, flow: "past",
    plan: [[4, 0, "+"], [10, 1, "+"], [16, 2, "+"], [26, 3, "+"], [35, 4, "+"], [47, 5, "+"], [55, 6, "+"], [63, 7, "+"],
      [69, 8, "+"], [75, 9, "+"], [81, 1, "-"], [95, 5, "-"], [105, 1, "+"], [112, 3, "-"]],
    description: "Learn the four-team BP format, the roles of each speaker and how adjudicators score a round. No experience needed.\n\nAgenda:\n- Opening 30 minutes: the four teams, speaking order and what each speaker must do.\n- Next hour: a short demonstration round with club members.\n- Final stretch: you try a mini round in small groups while adjudicators give live feedback.\n\nBring a notebook and a pen; laptops are optional. Wear whatever is comfortable, there is no dress code. Free to attend with 8 places in Main Building Room 230, so every newcomer gets real feedback. Newcomers are warmly welcome, and nobody is forced to speak if they would rather watch and take notes first." },
  { club: "hiking", venue: V.studio, day: -9, slot: "morning", title: "Dragon's Back Trail Briefing", capacity: 8, tags: ["sports"], club_tags: ["Beginner friendly"], reg: 10, attend: 6, flow: "past",
    // One person drops off the waitlist, a leave promotes the next in line, and a seat opens up for a rejoin.
    plan: [[6, 0, "+"], [13, 1, "+"], [21, 2, "+"], [30, 3, "+"], [41, 4, "+"], [50, 5, "+"], [60, 6, "+"], [66, 7, "+"],
      [72, 8, "+"], [78, 9, "+"], [85, 8, "-"], [90, 0, "-"], [98, 3, "-"], [101, 5, "-"], [106, 0, "+"]],
    description: "Route, kit list and safety briefing before the club's first Dragon's Back hike.\n\nWhat we cover:\n- The route, timings and the MTR and bus plan for getting to the trailhead.\n- Kit list: trail shoes with grip, 1.5 litres of water, sun hat, snacks and a rain layer.\n- Safety: staying together, heat and hydration, what to do if someone slows down, and who carries the first aid kit.\n\nThis is a classroom-style session at the Sports Centre Studio, open to all levels and ideal if you have never hiked with a group. Free, 8 places. Please arrive on time and bring questions. Attendance is noted so we know who has heard the briefing before the hike itself." },
  { club: "robotics", venue: V.union, day: -7, slot: "afternoon", title: "Line-Follower Robot Workshop", capacity: 3, visibility: "members_only", tags: ["tech"], club_tags: ["Hands-on"], reg: 4, attend: 3, flow: "past",
    // Requests are accepted a couple of hours later; one is withdrawn while pending, the fourth waits for a seat.
    plan: [[6, 0, "+"], [8, 0, "ok"], [20, 1, "+"], [22, 1, "ok"], [40, 2, "+"], [41, 2, "-"], [47, 2, "+"], [49, 2, "ok"], [55, 3, "+"], [57, 3, "ok"],
      [72, 1, "-"], [90, 1, "+"], [92, 1, "ok"], [101, 0, "-"]],
    description: "Build a two-wheel line follower from the club's kit and tune its sensor thresholds. Members only, kits are limited.\n\nPlan for the session:\n- First 30 minutes: kit tour and wiring walkthrough.\n- Middle block: assemble the chassis, fit the sensors and upload the starter code.\n- Final hour: calibrate thresholds and race on the test track.\n\nBuilders share the club's three kits, so 3 places is a hard limit. Beginners are fine; a committee member will help at each bench. Bring a laptop with the Arduino software installed if you can, and tie back long hair and wear closed shoes near the soldering station. Free for members. Check in at the Student Union Activity Room door." },
  { club: "photo", venue: V.room, day: -3, slot: "evening", title: "Portrait Lighting Basics", capacity: 10, visibility: "members_only", tags: ["arts"], club_tags: ["Beginner friendly"], reg: 4, attend: 3, flow: "past",
    plan: [[5, 0, "+"], [7, 0, "ok"], [20, 1, "+"], [22, 1, "ok"], [30, 2, "+"], [31, 2, "-"], [60, 2, "+"], [62, 2, "ok"], [45, 3, "+"], [47, 3, "ok"], [90, 1, "-"]],
    description: "One-light and two-light portrait set-ups with the society's speedlights.\n\nWhat happens:\n- First 20 minutes: how light direction and distance change a face.\n- Next hour: rotate through one-light stations, then add a second light for fill and rim.\n- Last 30 minutes: shoot each other and compare results on screen.\n\nMembers only, 10 places, free. Beginners are welcome as long as you know the basics of your camera. Bring a camera that can shoot manually, a charged battery and a memory card; the society supplies speedlights and stands. Wear plain, mid-tone clothes if you plan to model. Be kind to the gear and tell the committee about any cable you trip over." },

  // Upcoming and open for registration.
  { club: "photo", venue: V.hall, day: 2, slot: "night", title: "Night Photography on the Harbourfront", capacity: 25, tags: ["arts", "social"], club_tags: ["Outdoor"], reg: 6,
    plan: [[4, 0, "+"], [9, 1, "+"], [15, 2, "+"], [27, 3, "+"], [40, 4, "+"], [55, 5, "+"], [70, 2, "-"], [85, 2, "+"]],
    description: "Long exposures of the harbour lights. Bring a tripod if you have one; the society lends a few.\n\nPlan:\n- Meet at Lok Yew Hall for a 20-minute primer on shutter speed, ISO and focus in the dark.\n- Travel together to the harbourfront by MTR and walk to the viewpoint.\n- Spend roughly an hour on long exposures, light trails and reflections on the water.\n\nOpen to everyone, 25 places, free. Wear dark, warm layers and non-slip shoes, and bring a torch or phone light, a spare battery and a remote or timer. Stay in the group, keep away from the water's edge and watch your tripod legs for passers-by. If rain is forecast we will tell registered students by notification before the start." },
  { club: "film", venue: V.cinema, day: 3, slot: "night", title: "Short Film Pitch Night", capacity: 80, tags: ["arts", "career"], club_tags: ["Workshop"], reg: 7,
    plan: [[5, 0, "+"], [11, 1, "+"], [20, 2, "+"], [33, 3, "+"], [47, 4, "+"], [60, 5, "+"], [72, 6, "+"], [80, 3, "-"], [96, 3, "+"], [104, 1, "-"]],
    description: "Pitch a five-minute short film idea in two minutes. The best three pitches get the club's camera kit for a weekend.\n\nHow the night runs:\n- Opening 20 minutes: a quick guide to what makes a pitch land (character, conflict, one striking image).\n- Main block: each pitcher gets two minutes, then one minute of friendly questions.\n- Wrap-up: the committee and audience vote and announce the top three.\n\nOpen to all, with 80 places; you can pitch or just cheer from the audience. Prepare a few notes or one slide, nothing fancy. Free. Bring a pen for voting slips. If more people sign up to pitch than time allows, the committee draws names, and everyone else is welcome to watch." },
  { club: "debate", venue: V.union, day: 4, slot: "evening", title: "Debate Social: Pizza and Motions", capacity: 30, tags: ["social", "free-food"], club_tags: ["Social"], reg: 5,
    plan: [[3, 0, "+"], [8, 1, "+"], [22, 2, "+"], [41, 3, "+"], [66, 4, "+"], [75, 1, "-"], [98, 1, "+"], [110, 3, "-"]],
    description: "Casual impromptu motions over pizza. A relaxed way to meet the club.\n\nWhat to expect:\n- First 30 minutes: pizza, drinks and name games so nobody stands alone.\n- Then three rounds of light-hearted motions (think pineapple, cats versus dogs, early lectures), two minutes of prep each, with speaking in pairs.\n- Last stretch: free chat and a quick look at upcoming club events.\n\nOpen to everyone, no debating experience required, and no pressure to speak. Free, with 30 places at the Student Union Activity Room. Tell the committee about dietary needs when you register so we can order vegetarian options. Bring a friend, an appetite and your best hot take." },
  { club: "hiking", venue: V.studio, day: 5, slot: "early_morning", title: "Lion Rock Sunrise Hike", capacity: 6, tags: ["sports"], club_tags: ["Advanced"], reg: 8,
    // Six seats fill, two queue; one person cancels (the first in line gets the seat) and rejoins at the back, so two stay waitlisted.
    plan: [[2, 0, "+"], [6, 1, "+"], [11, 2, "+"], [19, 3, "+"], [28, 4, "+"], [37, 5, "+"], [50, 6, "+"], [58, 7, "+"], [75, 1, "-"], [88, 1, "+"]],
    description: "An early, steep climb up Lion Rock. Places are limited to six per guide, so later sign-ups join the waitlist.\n\nPlan:\n- Meet at 06:00 in the dark with headtorches on; we leave promptly.\n- About 50 minutes of steady, steep climbing, a guide at the front and one at the back, reaching the ridge as the sun comes up.\n- Twenty minutes at the summit for sunrise photos, then a careful descent together, back by 08:00.\n\nThis is an advanced route: steep steps, loose rock and exposed sections. Wear proper hiking shoes, carry at least 1.5 litres of water, a headtorch, snacks and a windproof layer. Only join if you are comfortable with sustained climbing. Free. Capacity is six; waitlisted students are promoted if someone drops out, so cancel early if you cannot make it." },
  { club: "robotics", venue: V.hall, day: 6, slot: "afternoon", title: "Robot Sumo Tournament", capacity: 40, tags: ["tech", "social"], club_tags: ["Competition"], reg: 6,
    plan: [[4, 0, "+"], [12, 1, "+"], [25, 2, "+"], [38, 3, "+"], [52, 4, "+"], [66, 5, "+"], [78, 0, "-"], [92, 0, "+"], [105, 4, "-"]],
    description: "Bring a robot under 500 g, or come to watch. Brackets are drawn on the day.\n\nSchedule:\n- First 30 minutes: weigh-in and safety check at the entrance.\n- Main block: knockout rounds in the ring, best of three pushes per match.\n- Final stretch: the final, a prize and a group photo.\n\nOpen to everyone with 40 places in total, free to enter. Beginners can borrow a spare club bot, ask the committee in advance. Rules: no flame, no liquids, no entanglement or flying parts, and robots must be switched off between matches. Watchers should stay behind the barrier and keep fingers out of the ring. Bring a spare battery and a screwdriver for quick fixes." },
  { club: "photo", venue: V.union, day: 7, slot: "afternoon", title: "Film Camera Swap Meet", capacity: 30, tags: ["arts", "social"], club_tags: [], reg: 4,
    description: "Swap, sell or just look at film cameras and lenses. The committee will test shutters on request.\n\nWhat happens:\n- Set up in the first 20 minutes: claim a table space and lay out what you want to trade.\n- Rest of the session: browse, haggle and chat, with a committee member testing shutters and light seals at a help table.\n- Final 30 minutes: a show-and-tell of the best find and a few sample frames.\n\nOpen to everyone with 30 places, free to attend. Bring cameras and lenses you want to trade, with small cash for deals (the club is not part of any sale). Beginners are welcome, and many sellers will happily explain how to load a roll. Handle other people's gear with care and keep bags off the tables." },
  { club: "film", venue: V.cinema, day: 8, slot: "night", title: "Members' Screening: Classic Noir", capacity: 40, visibility: "members_only", tags: ["arts", "culture"], club_tags: ["Screening"], reg: 4,
    // Two requests accepted (one of them later leaves), one withdrawn while pending, one still waiting.
    plan: [[6, 0, "+"], [8, 0, "ok"], [14, 1, "+"], [17, 1, "ok"], [30, 2, "+"], [44, 3, "+"], [60, 3, "-"], [75, 1, "-"]],
    description: "A members-only screening of a 1940s film noir classic. Popcorn provided.\n\nPlan for the night:\n- Doors open 15 minutes early; please bring your membership card or be ready for a name check.\n- The feature plays in full, with popcorn handed out at the door.\n- About 15 minutes of informal chat afterwards for favourite lines and shadows.\n\nMembers only, 40 places, free. If you want to bring a guest, ask the committee first, as non-members can request a place through the club page. Dress warmly because the cinema is cool, and keep your phone off. If you registered but cannot attend, please cancel early so someone on the waitlist can take the seat." },
  { club: "debate", venue: V.room, day: 9, slot: "morning", title: "Inter-Hall Debate Trials", capacity: 16, visibility: "members_only", tags: ["academic"], club_tags: ["BP format"], reg: 4, accept: 1,
    description: "Trials for the team that represents the club at the inter-hall competition. Members only.\n\nHow it works:\n- Opening 20 minutes: format reminder and draw of teams and rooms.\n- Two trial rounds with a short break between, each judged by senior members.\n- Final 30 minutes: feedback on delivery, structure and teamwork. The committee shares the final team shortly after.\n\nMembers only, 16 places, free. Previous debating experience helps but strong beginners are welcome to try. Bring a notebook, a pen and water. Dress is smart casual. Everyone gets feedback whether or not they make the squad, and the committee will confirm check-in at the door of Main Building Room 230." },
  { club: "hiking", venue: V.studio, day: 10, slot: "full_day", title: "MacLehose Stage 2 Day Hike", capacity: 20, tags: ["sports"], club_tags: ["Advanced"], reg: 5,
    description: "Sai Wan to Pak Tam Au with a swim stop at Tai Long Wan. About seven hours of walking.\n\nPlan:\n- Meet at the agreed MTR exit and travel together to the trailhead by minibus.\n- Roughly seven hours on the trail with regular water stops, a lunch break and a swim at the beach.\n- Finish at Pak Tam Au and travel back together.\n\nThis is an advanced day hike with long stretches in full sun. Bring 2 litres of water, lunch and snacks, sun cream, a hat, swimwear and a quick-dry towel, plus hiking shoes with good grip. Free to join, but transport fares are shared at cost. Capacity is 20. Tell a guide about any health condition. Swimming is optional and at your own risk, and we stay together as a group." },
  { club: "robotics", venue: V.room, day: 11, slot: "afternoon", title: "Arduino for Beginners", capacity: 30, tags: ["tech", "academic"], club_tags: ["Hands-on"], reg: 7,
    description: "Blink an LED, read a sensor and drive a servo. Laptops needed; boards provided.\n\nPlan:\n- First 30 minutes: install the Arduino software and check your board connects.\n- Next block: blink an LED, then read a light sensor and print the values.\n- Final stretch: drive a servo from your sensor reading and show it off.\n\nNo experience is needed. Bring a laptop with a free USB port (a USB adapter helps) and charge it first. Boards, wires and sensors are provided and returned at the end. Free, with 30 places. Wear closed shoes, and keep drinks away from the electronics. A committee member will help at every table, so ask as many questions as you like." },
  { club: "photo", venue: V.room, day: 12, slot: "evening", title: "Photo Critique Circle", capacity: 12, visibility: "members_only", tags: ["arts"], club_tags: [], reg: 3, accept: 2,
    description: "Bring three photos for friendly feedback from the committee and other members.\n\nFormat:\n- Opening 15 minutes: ground rules for kind, specific feedback.\n- Main block: each member shows three photos, then gets around five minutes of comments on composition, light and story.\n- Final 20 minutes: pick one photo to improve, and note an idea to try before the next circle.\n\nMembers only, 12 places, free. All levels are welcome, and phone photos count. Send or bring your images as files on a laptop or USB drive, with a title for each. Come ready to listen as much as to talk. Please check in at the door, and if you need to drop out, cancel early so a waitlisted member can take your place." },
  { club: "film", venue: V.union, day: 14, slot: "afternoon", title: "Screenwriting Workshop", capacity: 25, tags: ["arts", "academic"], club_tags: ["Workshop"], reg: 3,
    description: "Structure, scene goals and dialogue, with short writing exercises.\n\nPlan:\n- First 30 minutes: three-act structure and why every scene needs a goal and an obstacle.\n- Middle hour: write a one-page scene from a prompt, then swap with a partner for notes.\n- Last 30 minutes: read a few scenes aloud and discuss what worked.\n\nOpen to everyone, 25 places, free. Complete beginners are welcome, though keen writers will enjoy the notes too. Bring a laptop or a notebook and pen, plus an idea you would like to develop. We keep feedback kind and focused on the page rather than the person. A committee member will facilitate and keep time at the Student Union Activity Room." },
  { club: "debate", venue: V.hall, day: 15, slot: "morning", title: "Public Speaking Bootcamp", capacity: 50, tags: ["career", "academic"], club_tags: [], reg: 4,
    description: "Voice, pacing and handling questions, for interviews and presentations as much as debates.\n\nSchedule:\n- First 40 minutes: breathing, projection and pacing drills in big groups.\n- Next 50 minutes: three-minute talks in small circles with timed feedback.\n- Final 30 minutes: practising answers to surprise questions, as in interviews and class presentations.\n\nOpen to everyone, 50 places in Lok Yew Hall. No experience needed, and shy speakers are especially welcome. Bring water, a notebook and a topic you care about. Wear something you feel confident in. Free to attend. Registered students are checked in by the committee on arrival, and if the session is full the waitlist is released at the start time." },
  { club: "robotics", venue: V.hall, day: 18, slot: "afternoon", title: "Robotics Lab Open Day", capacity: 80, tags: ["tech", "social"], club_tags: [], reg: 3,
    description: "Try the club's robots, see current projects and meet the build teams.\n\nWhat's on:\n- Demo stations around the hall: line followers, sumo bots, a robot arm and a camera-guided rover.\n- Short talks every 30 minutes about how each team got started.\n- A beginners' table where you can try a simple build and ask what to learn first.\n\nOpen to everyone, 80 places, free. No technical background needed; just curiosity. Wear closed shoes and keep to the marked walkways, and ask before touching moving machines. Bring a friend and questions. Members will be on hand to explain how to join the club and which project teams are looking for new people." },
  { club: "hiking", venue: V.studio, day: 20, slot: "morning", title: "Volunteer Trail Clean-up", capacity: 25, tags: ["volunteering", "sports"], club_tags: ["Beginner friendly"], reg: 4,
    description: "Litter picking along a country park trail with the park wardens. Gloves and bags provided.\n\nPlan:\n- Meet at the venue, then walk up to Lung Fu Shan Country Park together (about 15 minutes).\n- A 10-minute briefing from the wardens on what to pick up and what to leave alone.\n- About an hour of litter picking in small groups, then a rest, a tally of what we collected and the walk back.\n\nOpen to all levels. Wear long trousers, sturdy shoes, sun protection and bring a water bottle and snack. Gloves, bags and tongs are supplied. Free, with 25 places. Please do not pick up sharp or hazardous items; tell a guide instead. Volunteers who join may be eligible for service hours, so ask the committee." },

  // Still moving through the approval workflow.
  { club: "photo", venue: V.room, day: 16, slot: "afternoon", title: "Exhibition Planning Meeting", capacity: 20, visibility: "members_only", tags: ["arts"], club_tags: [], flow: "president_signoff", by: "committee1",
    description: "Plan the end-of-term exhibition: theme, venue and printing budget.\n\nAgenda:\n- First 15 minutes: recap of last year and a look at the draft timeline.\n- Next 45 minutes: theme brainstorm, then vote on a shortlist.\n- Final stretch: split into teams for venue, printing and promotion, and agree the next steps.\n\nMembers only, 20 places, free. All members are welcome even if you have not helped with an exhibition before; we need curators, printers and helpers. Bring ideas, a notebook and any print quotes you have found. Please check in at the door. This session is still going through approval, so details may change before it is published." },
  { club: "film", venue: V.cinema, day: 21, slot: "night", title: "Animation Night", capacity: 60, tags: ["arts", "social"], club_tags: ["Screening"], flow: "venue_pending",
    description: "Hand-drawn and stop-motion shorts from around the world.\n\nPlan:\n- Doors open 15 minutes early with seating on a first come basis.\n- About 85 minutes of shorts, with a short interval in the middle.\n- A quick chat afterwards on favourite techniques and how to try them yourself.\n\nOpen to everyone, with 60 places, free. No film experience is needed. Bring a light layer, since the cinema is chilly, and keep phones silent. If it fills up, join the waitlist and arrive on time, as we release unclaimed seats at the start. The booking is still waiting for venue approval, so the date and time may be adjusted before the event is published." },
  { club: "debate", venue: V.union, day: 13, slot: "afternoon", title: "Debate Workshop: Rebuttals", capacity: 25, tags: ["academic"], club_tags: ["BP format"], flow: "publish_signoff", by: "committee1",
    description: "Practise rebuttal structure and weighing in short drills.\n\nPlan:\n- First 20 minutes: the shape of a good rebuttal (claim, response, impact) with examples.\n- Middle hour: paired drills where one student makes an argument and the other has two minutes to answer it.\n- Final 30 minutes: weighing, which means comparing why your points matter more, then group feedback.\n\nOpen to all, 25 places, free. Some basic debating knowledge helps, but beginners will be supported. Bring a notebook, a pen and an open mind. Wear anything comfortable. This event is waiting for sign-off before it is published, so check the page for updates and the final time." },

  // Cancelled after people registered.
  { club: "robotics", venue: V.studio, day: 17, slot: "afternoon", title: "Drone Racing Demo", capacity: 20, tags: ["tech"], club_tags: ["Competition"], reg: 3, flow: "cancelled",
    cancel_reason: "The drone cage is under repair. We will announce a new date soon.",
    description: "Watch FPV drone pilots race through the club's indoor course.\n\nWhat was planned:\n- First 20 minutes: a safety briefing and a look at the course gates.\n- Main block: pilots fly timed heats while spectators watch from behind the nets.\n- Final stretch: a short Q&A about building and flying your own drone.\n\nOpen to everyone, 20 places, free. Wear closed shoes and keep behind the safety barrier at all times. Because the drone cage is under repair, this event is cancelled and the club will announce a new date. Registered students will be notified, and nothing is lost: any waitlist places carry over to the new date." },
];

// Registrations arrive over about four days, a little apart.
function default_plan({ reg, accept = 0 }) {
  const gap = Math.floor(84 / Math.max(reg, 1));
  return Array.from({ length: reg }, (_, i) => [[6 + i * gap, i, "+"], ...(i < accept ? [[8 + i * gap, i, "ok"]] : [])]).flat();
}

const SOURCES = ["explore", "club", "inbox", "my_events", "share"];

// Sessions for the seeder's own logins, kept in memory and dropped on exit.
// (express-session warns about its MemoryStore whenever NODE_ENV is production.)
class SeedSessionStore extends session.Store {
  sessions = new Map();
  get(id, done) { const text = this.sessions.get(id); done(null, text ? JSON.parse(text) : null); }
  set(id, data, done) { this.sessions.set(id, JSON.stringify(data)); done?.(); }
  destroy(id, done) { this.sessions.delete(id); done?.(); }
  touch(id, data, done) { done?.(); }
}

// A cookie-and-CSRF aware client for the in-process app.
class Client {
  constructor(base) { this.base = base; this.cookie = ""; this.csrf = null; }

  async request(method, path, body) {
    const headers = { Origin: ORIGIN };
    if (method !== "GET") {
      if (!this.csrf) this.csrf = (await this.request("GET", "/auth/csrf")).data.csrf_token;
      headers["X-CSRF-Token"] = this.csrf;
      headers["Content-Type"] = "application/json";
    }
    if (this.cookie) headers.Cookie = this.cookie;
    const response = await fetch(`${this.base}/api/v1${path}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
    const set = response.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${json?.error?.code ?? ""} ${json?.error?.message ?? ""}`.trim());
    return json ?? {};
  }

  get(path) { return this.request("GET", path); }
  post(path, body) { return this.request("POST", path, body); }
  put(path, body) { return this.request("PUT", path, body); }
  del(path) { return this.request("DELETE", path); }
}

const add_days = (date, days) => utc_to_campus_date(new Date(campus_to_utc(date, "12:00").getTime() + days * DAY_MS));

function account_list() {
  const accounts = [{ key: "admin", email: `admin@${DOMAIN}`, name: "Venue Administrator", platform_role: "venue_admin" }];
  for (const club of CLUBS) {
    const [president, c1, c2, m1, m2, m3] = PEOPLE[club.key];
    accounts.push(
      { key: `president.${club.key}`, name: president, club: club.key, role: "president" },
      { key: `committee1.${club.key}`, name: c1, club: club.key, role: "committee" },
      { key: `committee2.${club.key}`, name: c2, club: club.key, role: "committee" },
      { key: `member1.${club.key}`, name: m1, club: club.key, role: "member" },
      { key: `member2.${club.key}`, name: m2, club: club.key, role: "member" },
      { key: `member3.${club.key}`, name: m3, club: club.key, role: "member" },
    );
  }
  STUDENTS.forEach((name, index) => accounts.push({ key: `student${index + 1}`, name }));
  return accounts.map((account, index) => ({
    platform_role: "student", ...account,
    email: account.email ?? `${account.key}@${DOMAIN}`,
    student_id: `DEMO${String(index + 1).padStart(4, "0")}`,
  }));
}

// Returns why seeding should be skipped, or null when the database is empty.
async function skip_reason(pool) {
  const [[{ events }]] = await pool.query("SELECT COUNT(*) AS events FROM events");
  if (Number(events) > 0) return "The database already has events.";
  const [[{ demo }]] = await pool.query("SELECT COUNT(*) AS demo FROM users WHERE email LIKE ?", [`%@${DOMAIN}`]);
  if (Number(demo) > 0) return "Demo accounts already exist.";
  return null;
}

async function seed_demo({ pool, password, now = new Date(), hasher = create_password_hasher(), log = console.log }) {
  if (!password || password.length < 12) throw new Error("DEMO_ACCOUNT_PASSWORD must be at least 12 characters.");
  const reason = await skip_reason(pool);
  if (reason) return { skipped: reason };

  // ---- catalogue and accounts (direct SQL; no API creates these) -------------
  const club_ids = {};
  for (const club of CLUBS) {
    await pool.query("INSERT INTO clubs (name, description) SELECT ?, ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM clubs WHERE name = ?)", [club.name, club.description, club.name]);
    club_ids[club.key] = (await pool.query("SELECT id FROM clubs WHERE name = ?", [club.name]))[0][0].id;
  }
  const venue_ids = {};
  for (const venue of VENUES) {
    await pool.query("INSERT INTO venues (name, location, capacity, description) SELECT ?, ?, ?, ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM venues WHERE name = ?)",
      [venue.name, venue.location, venue.capacity, venue.description, venue.name]);
    venue_ids[venue.name] = (await pool.query("SELECT id FROM venues WHERE name = ?", [venue.name]))[0][0].id;
  }
  const accounts = account_list();
  const password_hash = await hasher.hash(password);
  const users = {};
  for (const account of accounts) {
    const [insert] = await pool.query("INSERT INTO users (email, password_hash, name, student_id, platform_role) VALUES (?, ?, ?, ?, ?)",
      [account.email, password_hash, account.name, account.student_id, account.platform_role]);
    users[account.key] = { ...account, id: insert.insertId };
    if (account.club) await pool.query("INSERT INTO memberships (user_id, club_id, role) VALUES (?, ?, ?)", [insert.insertId, club_ids[account.club], account.role]);
  }
  for (const [key, club] of EXTRA_MEMBERS) {
    await pool.query("INSERT INTO memberships (user_id, club_id, role) VALUES (?, ?, 'member')", [users[key].id, club_ids[club]]);
  }

  // ---- the real API on a simulated clock -------------------------------------
  let clock_now = new Date(now);
  const set_clock = (date) => { clock_now = new Date(date); };
  const clock = () => (clock_now = new Date(clock_now.getTime() + 1));
  const stack = create_v1_stack({ pool, hasher, clock, throttle_limits: { login: 10_000, register: 10_000, ip: 100_000 }, hub_options: { logger: { error() {} } } });
  const app = create_app({ session_secret: randomBytes(32).toString("hex"), session_store: new SeedSessionStore(), app_origin: ORIGIN, v1_routers: stack.routers, is_multipart_route: stack.is_multipart_route, logger: { error() {} } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const clients = new Map();
  const as = async (key) => {
    if (!clients.has(key)) {
      const client = new Client(base);
      await client.post("/auth/login", { email: users[key].email, password });
      client.csrf = (await client.get("/auth/csrf")).data.csrf_token;
      clients.set(key, client);
    }
    return clients.get(key);
  };

  const summary = { clubs: CLUBS.length, accounts: accounts.length, events: 0, registrations: 0, leaves: 0, promotions: 0, check_ins: 0, views: 0 };
  try {
    // Club tags, created by each president.
    const tag_ids = {};
    for (const club of CLUBS) {
      for (const name of club.tags) {
        const tag = (await (await as(`president.${club.key}`)).post(`/clubs/${club_ids[club.key]}/tags`, { name })).data;
        tag_ids[`${club.key}:${name}`] = tag.id;
      }
    }
    const [campus_rows] = await pool.query("SELECT id, slug FROM campus_tags WHERE retired_at IS NULL");
    const campus = Object.fromEntries(campus_rows.map((row) => [row.slug, row.id]));

    // People who register for public events, in rotation: plain members and students.
    const pool_keys = accounts.filter((a) => a.role === "member" || a.key.startsWith("student")).map((a) => a.key);
    const today = utc_to_campus_date(now);
    let rotation = 0;

    // Past events first (moving the clock back), then today's view of the future.
    const ordered = [...EVENTS].sort((a, b) => a.day - b.day);
    for (const spec of ordered) {
      const date = add_days(today, spec.day);
      const start = campus_to_utc(date, slot_by_id(spec.slot).start);
      // Events with registrations are published days before the event (past) or before today (upcoming), so their history has room to unfold.
      const published_at = new Date(spec.flow === "past" ? start.getTime() - 6 * DAY_MS : spec.reg ? now.getTime() - 5 * DAY_MS : now.getTime());
      set_clock(published_at);
      const club_id = club_ids[spec.club];
      const president = await as(`president.${spec.club}`);
      const committee = await as(`committee1.${spec.club}`);
      const creator = spec.by ? await as(`${spec.by}.${spec.club}`) : president;
      const admin = await as("admin");

      let event = (await creator.post("/events", {
        club_id, venue_id: venue_ids[spec.venue], title: spec.title, description: spec.description, date, slot_id: spec.slot,
        visibility: spec.visibility ?? "public", capacity: spec.capacity,
        campus_tag_ids: spec.tags.map((slug) => campus[slug]), club_tag_ids: spec.club_tags.map((name) => tag_ids[`${spec.club}:${name}`]),
      })).data;
      summary.events += 1;
      if (spec.flow === "president_signoff") continue;
      if (event.booking.status === "awaiting_president") {
        event = (await president.post(`/bookings/${event.booking.id}/signoff`, { expected_version: event.booking.version, decision: "send" })).data ?? event;
        event = (await creator.get(`/events/${event.id}`)).data;
      }
      if (spec.flow === "venue_pending") continue;
      await admin.post(`/bookings/${event.booking.id}/decision`, { expected_version: event.booking.version, decision: "approve" });
      event = (await creator.get(`/events/${event.id}`)).data;
      event = (await creator.post(`/events/${event.id}/publish`, { expected_version: event.version })).data;
      if (spec.flow === "publish_signoff") continue;

      // Registrations.
      const members_only = spec.visibility === "members_only";
      const takers = [];
      if (members_only) {
        const [rows] = await pool.query("SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.club_id = ? AND m.role = 'member' ORDER BY m.user_id", [club_id]);
        const keys = rows.map((row) => row.email.split("@")[0]);
        takers.push(...keys.slice(0, spec.reg));
      } else {
        while (takers.length < spec.reg) {
          const key = pool_keys[rotation++ % pool_keys.length];
          if (!takers.includes(key)) takers.push(key);
        }
      }
      // Browsers: people who open the event page without registering, so the
      // activity report has members and non-members who looked but didn't join.
      // Visits fall between publication and the earlier of the event's start
      // and the seed's "now"; a third of them come back a day later.
      const view_end = Math.min(start.getTime() - 3_600_000, now.getTime() - 30 * 60_000);
      const span = view_end - published_at.getTime();
      if (span > 3_600_000) {
        const outside = (key) => !takers.includes(key);
        const members = accounts.filter((a) => a.club === spec.club && a.role === "member").map((a) => a.key).filter(outside);
        const others = pool_keys.filter((key) => users[key].club !== spec.club).filter(outside);
        const total = Math.min(14, Math.max(4, Math.round(spec.capacity / 3)));
        const member_count = Math.min(members.length, Math.round(total * 0.4));
        const pick = (list, n, offset) => Array.from({ length: Math.min(n, list.length) }, (_, i) => list[(offset + i) % list.length]);
        const browsers = [
          ...pick(members, member_count, summary.events).map((key) => ({ key, sources: ["club", "inbox"] })),
          ...pick(others, total - member_count, summary.events * 3).map((key) => ({ key, sources: ["explore", "share"] })),
        ];
        const visit = async (key, at, source) => {
          set_clock(new Date(at));
          await (await as(key)).post(`/events/${event.id}/views`, { source });
          summary.views += 1;
        };
        for (const [index, { key, sources }] of browsers.entries()) {
          const at = published_at.getTime() + Math.round(span * ((index + 1) / (browsers.length + 2)));
          await visit(key, at, sources[index % sources.length]);
          if (index % 3 === 0 && at + DAY_MS < view_end) await visit(key, at + DAY_MS, sources[(index + 1) % sources.length]);
        }
        // The committee opens its own event while managing it (the report leaves this out).
        await visit(`committee1.${spec.club}`, published_at.getTime() + Math.round(span / 2), "club");
      }
      // Everyone follows the plan on the clock; each person looks at the event just before registering.
      const steps = (spec.plan ?? default_plan({ reg: takers.length, accept: spec.accept })).map(([hours, who, op], order) => ({ hours, who, op, order })).sort((a, b) => a.hours - b.hours || a.order - b.order);
      for (const { hours, who, op } of steps) {
        set_clock(new Date(published_at.getTime() + hours * 3_600_000));
        if (op === "ok") {
          await committee.post(`/events/${event.id}/join-requests/${users[takers[who]].id}/decision`, { decision: "accept" });
          continue;
        }
        const client = await as(takers[who]);
        if (op === "-") {
          await client.del(`/events/${event.id}/registration`);
          continue;
        }
        await client.post(`/events/${event.id}/views`, { source: SOURCES[rotation % SOURCES.length] });
        summary.views += 1;
        await client.post(`/events/${event.id}/registration`, { allow_waitlist: true });
        summary.registrations += 1;
      }

      if (spec.flow === "cancelled") {
        event = (await president.get(`/events/${event.id}`)).data;
        await president.post(`/events/${event.id}/cancel`, { expected_version: event.version, reason: spec.cancel_reason });
      }

      if (spec.flow === "past") {
        set_clock(new Date(start.getTime() + 10 * 60_000));
        const { code } = (await committee.post(`/events/${event.id}/checkin`, {})).data;
        const [joined] = await pool.query("SELECT user_id FROM participations WHERE event_id = ? AND status = 'joined' ORDER BY user_id", [event.id]);
        const present = joined.slice(0, spec.attend);
        for (const [index, row] of present.entries()) {
          const key = Object.keys(users).find((k) => users[k].id === row.user_id);
          if (index === present.length - 1) await committee.put(`/events/${event.id}/attendance/${row.user_id}`, {});
          else await (await as(key)).post(`/events/${event.id}/attendance`, { code });
          summary.check_ins += 1;
        }
      }
    }

    // Leaves and promotions are counted from the history the API wrote.
    const [[counts]] = await pool.query("SELECT COALESCE(SUM(action = 'left'), 0) AS leaves, COALESCE(SUM(action = 'promoted'), 0) AS promotions FROM participation_history");
    summary.leaves = Number(counts.leaves);
    summary.promotions = Number(counts.promotions);

    // Club join requests waiting for the committee (today).
    set_clock(now);
    for (const [key, club] of CLUB_REQUESTS) await (await as(key)).put(`/clubs/${club_ids[club]}/membership`, {});
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }

  log?.(`Demo data: ${summary.clubs} clubs, ${summary.accounts} accounts, ${summary.events} events, ${summary.registrations} registrations, ${summary.leaves} leaves, ${summary.promotions} promotions, ${summary.check_ins} check-ins, ${summary.views} event page views.`);
  return { summary, accounts: accounts.map(({ email, name, platform_role, club, role }) => ({ email, name, platform_role, club, role })) };
}

export { CLUBS, DOMAIN, EVENTS, account_list, seed_demo, skip_reason };
