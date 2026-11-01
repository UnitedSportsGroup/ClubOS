// Curated, captioned club photography for Content Studio's AI designer (2026-11-01).
// Sources: photographs already published on the club's own public sites and brand hubs
// (cufc-website, siu-website, mfl-website, cugc-website, cicyouth-website and the cufc/siu/mfl/
// cic/cugc/usc/usg brand hubs). Real photographs only: no logos, posters, mockups or AI imagery;
// photos already in the Mailer kit (brand-kit.ts, client/public/mailer/<brand>/*.jpg) are not repeated.
// Files: client/public/mailer/<brand>/lib/*.jpg, long edge <= 1800 px, progressive JPEG, metadata stripped.
// Captions describe what is visible; no individuals are named.
// 2026-11-01 (later): +148 photographs from the NAS archive (Business/USG/<brand> + camera dumps), see the block at the end.

export interface StudioPhoto { brand: string; src: string; w: number; h: number; caption: string; tags: string[] }

export const STUDIO_PHOTOS: readonly StudioPhoto[] = [
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/futsal-cage-pitch-day.jpg",
    "w": 1800,
    "h": 1012,
    "caption": "Empty blue-walled futsal cage with a white centre circle under a clear blue sky, trees behind; clean sky across the top third",
    "tags": [
      "venue",
      "wide",
      "landscape",
      "space-top",
      "futsal",
      "football"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/aerial-blue-pitch-angle.jpg",
    "w": 1800,
    "h": 1012,
    "caption": "Angled aerial of a turf pitch with a blue surround and a small stand, paddocks beyond; quiet grass and sky at the top",
    "tags": [
      "venue",
      "wide",
      "landscape",
      "space-top",
      "football"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/youth-match-dribble-sideline.jpg",
    "w": 1600,
    "h": 1346,
    "caption": "Boys about 12-14 in blue and black kits contest the ball on turf, spectators and event tents behind; daylight",
    "tags": [
      "action",
      "youth",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/two-players-mountain-backdrop.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Two teen players in white kits, backs to camera, hugging beside a grass pitch with mountains and blue sky; clear space at top and right",
    "tags": [
      "youth",
      "team",
      "landscape",
      "space-top",
      "space-right",
      "football"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/first-team-lineup-fusion.jpg",
    "w": 1242,
    "h": 965,
    "caption": "Senior men in blue kits lined up arm in arm on turf before kick-off, green hedge behind",
    "tags": [
      "team",
      "adults",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/girl-kicking-evening-sun.jpg",
    "w": 1600,
    "h": 1066,
    "caption": "Girl about 9-11 in a blue kit striking a pink ball on a turf cage pitch in low evening sun, spectators blurred behind",
    "tags": [
      "action",
      "kids",
      "football",
      "landscape",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/crowd-mascot-kids-stand.jpg",
    "w": 1800,
    "h": 1125,
    "caption": "Dozens of kids in blue cheering in a stand beside the ram mascot, flags overhead, sunny",
    "tags": [
      "crowd",
      "kids",
      "celebration",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/kids-huddle-low-angle.jpg",
    "w": 1600,
    "h": 1200,
    "caption": "Low-angle huddle of smiling boys about 8-11 in blue kits looking down at the camera, a football in frame",
    "tags": [
      "kids",
      "team",
      "celebration",
      "close-up",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/teen-boys-celebrate-group.jpg",
    "w": 1600,
    "h": 1120,
    "caption": "Teen boys in blue kits celebrating together on the pitch, shaking hands and hugging, floodlight gantry behind",
    "tags": [
      "youth",
      "celebration",
      "team",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/young-kids-chase-ball-bibs.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Boys about 5-7 in blue shirts and yellow bibs chase a ball in front of a goal, a coach watching from behind",
    "tags": [
      "kids",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/kids-sprint-cones-drill.jpg",
    "w": 1272,
    "h": 850,
    "caption": "Boys about 9-11 in blue kits sprinting between pink cones in a training drill on grass-green turf",
    "tags": [
      "kids",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/two-boys-contest-ball.jpg",
    "w": 1272,
    "h": 850,
    "caption": "Two boys about 11-12 in blue kits contest a ball on turf with training cones and goals behind",
    "tags": [
      "kids",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/coach-talking-young-players.jpg",
    "w": 1272,
    "h": 850,
    "caption": "Coach in a blue tracksuit talking with a group of young kids in bibs beside a goal",
    "tags": [
      "coach",
      "kids",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/youth-dribble-past-black-kit.jpg",
    "w": 1600,
    "h": 1346,
    "caption": "Boy about 13-14 in a blue kit dribbling past an opponent in black, spectators and sponsor boards behind",
    "tags": [
      "youth",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/boy-ball-juggle-blue-pitch.jpg",
    "w": 1600,
    "h": 1165,
    "caption": "Boy about 11-12 in a blue kit flicking a ball at knee height on a pitch with a blue surround, warm late sun; space at right",
    "tags": [
      "kids",
      "action",
      "football",
      "landscape",
      "space-right"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/team-white-kits-kneeling.jpg",
    "w": 1600,
    "h": 1009,
    "caption": "Group photo of teen boys in white kits, some kneeling in front, a football at the centre, trees behind",
    "tags": [
      "team",
      "youth",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/kids-train-blue-pitch-wide.jpg",
    "w": 1400,
    "h": 933,
    "caption": "Wide view of small groups of kids training with balls on a blue-surround pitch under a pale sky; open sky at top",
    "tags": [
      "venue",
      "kids",
      "wide",
      "landscape",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/boys-celebrate-number-16.jpg",
    "w": 1600,
    "h": 1118,
    "caption": "Teen boys in blue kits celebrating together beside the pitch in cool afternoon light, marquee behind",
    "tags": [
      "celebration",
      "youth",
      "team",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/youth-tackle-green-strip.jpg",
    "w": 1600,
    "h": 1128,
    "caption": "Teen boy in blue and a player in a green and white strip contest the ball on bright turf, hillside behind",
    "tags": [
      "action",
      "youth",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/coaches-cones-training.jpg",
    "w": 1400,
    "h": 1400,
    "caption": "Two smiling coaches in grey club tops holding a ball beside training cones on turf",
    "tags": [
      "coach",
      "adults",
      "landscape",
      "close-up",
      "football"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/kids-hall-assembly.jpg",
    "w": 1400,
    "h": 933,
    "caption": "Large group of kids in blue tracksuits seated in a wooden-floored sports hall, adults watching from the side",
    "tags": [
      "crowd",
      "kids",
      "venue",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/team-trophy-blue-tracksuits.jpg",
    "w": 1400,
    "h": 933,
    "caption": "Teen boys in blue tracksuits holding a small trophy in front of a wall with banners, indoors",
    "tags": [
      "team",
      "youth",
      "celebration",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/kids-striped-kits-play.jpg",
    "w": 1400,
    "h": 930,
    "caption": "Young boys about 7-9 in blue-and-white striped kits playing on turf, one dribbling forward",
    "tags": [
      "kids",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/kids-walk-pitch-warmup.jpg",
    "w": 1400,
    "h": 933,
    "caption": "Kids about 9-12 in blue kits and bibs walking together across a pitch, a boy and a girl in the foreground",
    "tags": [
      "kids",
      "youth",
      "landscape",
      "football"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/small-boy-kicks-ball.jpg",
    "w": 1400,
    "h": 933,
    "caption": "Small boy about 5 in a blue kit kicking a ball, another child in a yellow bib behind, bright turf",
    "tags": [
      "kids",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/tiny-kids-dribble-turf.jpg",
    "w": 1400,
    "h": 933,
    "caption": "Boy about 4-5 in a blue kit dribbling a white ball past a child in a yellow bib on turf",
    "tags": [
      "kids",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/kids-fence-sideline-smiling.jpg",
    "w": 1400,
    "h": 933,
    "caption": "Group of smiling kids in club blue hoodies and jackets watching from behind a fence and goal net",
    "tags": [
      "crowd",
      "kids",
      "landscape",
      "football"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/warmup-stretch-mountains.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Players in blue stretching on a grass pitch with snow-capped mountains and blue sky behind; large clear sky area at top",
    "tags": [
      "team",
      "youth",
      "wide",
      "landscape",
      "space-top",
      "football"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/coach-microphone-goalpost.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Coach in a grey club polo crouched at a goalpost holding a microphone, blue sky above; space top and left",
    "tags": [
      "coach",
      "adults",
      "landscape",
      "space-top",
      "space-left"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/coach-talks-player-night.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Night close-up of a coach in a dark top crouched to speak with a player in a blue jacket, blurred blue shoulder at the left edge",
    "tags": [
      "coach",
      "night",
      "close-up",
      "landscape",
      "football",
      "space-right"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/team-huddle-white-kits.jpg",
    "w": 1787,
    "h": 1191,
    "caption": "Senior men in white away kits huddled on the pitch before kick-off, empty grey stand behind",
    "tags": [
      "team",
      "adults",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/squad-group-portrait-black.jpg",
    "w": 1800,
    "h": 1125,
    "caption": "Full men's squad in black team gear crouched and standing for a group portrait outside a building, kit bags in front",
    "tags": [
      "team",
      "adults",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/player-dribble-blue-boards.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "Man in a black training top dribbling a ball on a pitch with blue advertising boards, another man behind",
    "tags": [
      "action",
      "adults",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/striker-shot-keeper-dive.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Striker in a black kit shoots at goal as the keeper in orange dives and a defender lies on the pitch, bright daylight",
    "tags": [
      "action",
      "adults",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/two-players-fifa-boards.jpg",
    "w": 1800,
    "h": 1201,
    "caption": "Two players in white kits moving together in front of green boards and an empty grey stand",
    "tags": [
      "action",
      "adults",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/coach-gesturing-blurred-bibs.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Older man in a grey sweatshirt gesturing, blurred orange bib and black sleeve framing the shot; clear sky top left",
    "tags": [
      "coach",
      "adults",
      "landscape",
      "space-top"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/player-tv-interview-portrait.jpg",
    "w": 1200,
    "h": 1800,
    "caption": "Young player in a black training top smiling beside a TV camera and microphone on a tripod, pitch behind",
    "tags": [
      "portrait",
      "adults"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/sideline-bibs-hands-on-head.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Players in black tops and orange bibs standing on the sideline, one with hands on his head, blue-fenced pitch behind",
    "tags": [
      "team",
      "adults",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/slide-save-keeper-red.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Black-kit player stretches for the ball as the keeper in red slides across the goalmouth, daylight",
    "tags": [
      "action",
      "adults",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/training-two-players-centre-circle.jpg",
    "w": 1200,
    "h": 630,
    "caption": "Two men in dark training gear on a turf pitch with a centre circle, one striking the ball; open space above",
    "tags": [
      "action",
      "adults",
      "football",
      "landscape",
      "space-top"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/three-players-club-shirts-studio.jpg",
    "w": 1800,
    "h": 1137,
    "caption": "Three smiling players wearing black, white and green club shirts against a plain light-grey backdrop",
    "tags": [
      "adults",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/feet-ball-close-up.jpg",
    "w": 1200,
    "h": 630,
    "caption": "Close-up of players' feet and legs around a white match ball on green turf, bib blurred at the top",
    "tags": [
      "close-up",
      "action",
      "football",
      "landscape",
      "space-top"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/waterlogged-pitch-officials.jpg",
    "w": 1300,
    "h": 867,
    "caption": "Waterlogged pitch with standing water and officials inspecting it, a screen reading match suspended behind",
    "tags": [
      "venue",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/tackle-green-blue.jpg",
    "w": 1400,
    "h": 933,
    "caption": "Player in a green kit stretches to win the ball against a player in blue, sponsor boards behind",
    "tags": [
      "action",
      "adults",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/shoulder-duel-green-blue.jpg",
    "w": 1005,
    "h": 670,
    "caption": "Two players in green and blue shoulder to shoulder fighting for the ball, dark boards behind",
    "tags": [
      "action",
      "adults",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/slide-tackle-white-kit.jpg",
    "w": 1800,
    "h": 1201,
    "caption": "Player in a white kit slides for the ball in front of dark hoardings, wet turf spray, daylight",
    "tags": [
      "action",
      "adults",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/arms-out-goal-celebration.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Player in a black kit with arms stretched wide celebrating in front of a goal net",
    "tags": [
      "celebration",
      "adults",
      "football",
      "landscape",
      "space-bottom"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/goal-celebration-white-arms-up.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Players in white arms raised celebrating a goal while opponents in red sit on the grass in front of the net",
    "tags": [
      "celebration",
      "action",
      "adults",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/midfielder-dribble-referee.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Player in a black kit dribbling upfield with a referee in teal alongside, shipping container behind",
    "tags": [
      "action",
      "adults",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/aoraki-dark-mountain.jpg",
    "w": 1800,
    "h": 1012,
    "caption": "Dark monochrome mountain peak against a near-black sky; very dark, ideal behind light headline text (no people)",
    "tags": [
      "wide",
      "landscape",
      "space-left",
      "space-bottom"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/studio-black-shirt-hands-on-hips.jpg",
    "w": 1000,
    "h": 1500,
    "caption": "Player standing hands on hips in the black home shirt against a plain grey backdrop",
    "tags": [
      "portrait",
      "adults"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/studio-white-shirt-hands-on-hips.jpg",
    "w": 1000,
    "h": 1500,
    "caption": "Player standing hands on hips in the white away shirt against a plain grey backdrop",
    "tags": [
      "portrait",
      "adults"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/studio-green-shirt-standing.jpg",
    "w": 1000,
    "h": 1500,
    "caption": "Player standing arms behind his back in the green third shirt against a plain grey backdrop",
    "tags": [
      "portrait",
      "adults"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/man-black-top-blurred-bib.jpg",
    "w": 1200,
    "h": 630,
    "caption": "Man in a black training top standing on turf, blurred orange bib in the foreground; blue fencing behind",
    "tags": [
      "adults",
      "landscape",
      "space-left"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/players-heads-down-close.jpg",
    "w": 1200,
    "h": 630,
    "caption": "Three players in black training tops looking down, tight crop against a dark red blurred background",
    "tags": [
      "close-up",
      "adults",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/player-orange-bib-stadium-seats.jpg",
    "w": 1080,
    "h": 1440,
    "caption": "Young player in an orange bib standing on grass in front of blue stadium seats; space at the top left",
    "tags": [
      "portrait",
      "adults",
      "space-top"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/teen-yellow-kit-hands-over-face.jpg",
    "w": 1600,
    "h": 1066,
    "caption": "Teen boy in a yellow kit with hands over his face, blue-edged pitch, crowd and yellow marquee behind",
    "tags": [
      "youth",
      "celebration",
      "tournament",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/boys-contest-ball-number-10.jpg",
    "w": 1600,
    "h": 1066,
    "caption": "Boys about 9-11 in black, red and navy kits contest the ball in a tournament match",
    "tags": [
      "kids",
      "action",
      "tournament",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/yellow-team-celebration-huddle.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Boys in yellow kits huddled in celebration on a blue-edged pitch, yellow marquee and crowd behind",
    "tags": [
      "celebration",
      "team",
      "youth",
      "tournament",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/night-leap-white-kits.jpg",
    "w": 1600,
    "h": 1066,
    "caption": "Boys about 12-13 in white kits running under floodlights with one player leaping, dark night sky above; space at the top",
    "tags": [
      "night",
      "celebration",
      "action",
      "youth",
      "tournament",
      "landscape",
      "space-top"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/youth-match-tents-sideline.jpg",
    "w": 1600,
    "h": 1346,
    "caption": "Boys about 12-14 in blue and black kits contest the ball, event tents and spectators behind",
    "tags": [
      "action",
      "youth",
      "tournament",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/teen-boys-celebrate.jpg",
    "w": 1600,
    "h": 1120,
    "caption": "Teen boys in blue kits celebrating together on the pitch, floodlight gantry behind",
    "tags": [
      "celebration",
      "youth",
      "tournament",
      "team",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/coach-portrait-a.jpg",
    "w": 900,
    "h": 1200,
    "caption": "Woman coach in a navy club jacket with red and white sleeves smiling at the camera against a plain light-grey backdrop",
    "tags": [
      "portrait",
      "coach",
      "women",
      "gymnastics",
      "space-left",
      "space-right"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/coach-portrait-b.jpg",
    "w": 900,
    "h": 1200,
    "caption": "Woman coach in a navy club jacket with red and white sleeves smiling at the camera against a plain light-grey backdrop",
    "tags": [
      "portrait",
      "coach",
      "women",
      "gymnastics",
      "space-left",
      "space-right"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/coach-portrait-c.jpg",
    "w": 900,
    "h": 1200,
    "caption": "Woman coach in a navy club jacket with red and white sleeves smiling at the camera against a plain light-grey backdrop",
    "tags": [
      "portrait",
      "coach",
      "women",
      "gymnastics",
      "space-left",
      "space-right"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/night-futsal-strike.jpg",
    "w": 1400,
    "h": 1369,
    "caption": "Adult man in a white shirt striking a ball on a bright futsal turf at night, goalkeeper and goal behind",
    "tags": [
      "action",
      "adults",
      "futsal",
      "night",
      "landscape"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/futsal-volley-close-up.jpg",
    "w": 1400,
    "h": 935,
    "caption": "Smiling adult man in a blue top lashing a white ball mid-kick on a futsal pitch, blurred players behind",
    "tags": [
      "action",
      "close-up",
      "adults",
      "futsal",
      "landscape",
      "space-top"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/aerial-site-grass-and-turf.jpg",
    "w": 1800,
    "h": 1012,
    "caption": "Top-down aerial of the grass ground beside the car park with the small turf futsal court at lower right",
    "tags": [
      "venue",
      "wide",
      "landscape",
      "space-top"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/grass-ground-dusk.jpg",
    "w": 1800,
    "h": 1012,
    "caption": "Wide empty grass field at dusk with bare poplars and a goalpost, big pale sky across the top third",
    "tags": [
      "venue",
      "wide",
      "landscape",
      "space-top"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/night-futsal-cage.jpg",
    "w": 1400,
    "h": 1369,
    "caption": "Man kicking a ball on bright turf at night inside the futsal cage, goal and sign behind",
    "tags": [
      "night",
      "action",
      "futsal",
      "adults",
      "landscape"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/indoor-stadium-pitch.jpg",
    "w": 1600,
    "h": 721,
    "caption": "Wide view over an indoor stadium pitch with a roof, goalposts and empty stands, a few staff pitchside",
    "tags": [
      "venue",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/futsal-cage-blue-walls.jpg",
    "w": 1800,
    "h": 1012,
    "caption": "Empty blue-walled futsal cage with a white centre circle under a clear blue sky",
    "tags": [
      "venue",
      "wide",
      "landscape",
      "space-top",
      "futsal"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/aerial-blue-pitch.jpg",
    "w": 1800,
    "h": 1012,
    "caption": "Angled aerial of a turf pitch with a blue surround and a small stand, paddocks beyond",
    "tags": [
      "venue",
      "wide",
      "landscape",
      "space-top"
    ]
  },
  {
    "brand": "usg",
    "src": "https://app.usg.co.nz/mailer/usg/lib/aerial-site-grass-and-turf.jpg",
    "w": 1800,
    "h": 1012,
    "caption": "Top-down aerial of the grass ground beside the car park with the small turf futsal court at lower right",
    "tags": [
      "venue",
      "wide",
      "landscape",
      "space-top"
    ]
  },
  {
    "brand": "usg",
    "src": "https://app.usg.co.nz/mailer/usg/lib/aerial-blue-pitch.jpg",
    "w": 1800,
    "h": 1012,
    "caption": "Angled aerial of a turf pitch with a blue surround and a small stand, paddocks beyond",
    "tags": [
      "venue",
      "wide",
      "landscape",
      "space-top"
    ]
  },
  {
    "brand": "usg",
    "src": "https://app.usg.co.nz/mailer/usg/lib/indoor-stadium-pitch.jpg",
    "w": 1600,
    "h": 721,
    "caption": "Wide view over an indoor stadium pitch with a roof, goalposts and empty stands",
    "tags": [
      "venue",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/girls-7-9-arms-out-warmup-club-tops.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Three girls about 7-9 in navy United Gymnastics tops standing in a line with arms outstretched in a warm-up, wooden-beamed gym hall behind",
    "tags": [
      "kids",
      "girls",
      "gymnastics",
      "team",
      "warmup",
      "close-up",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/four-girls-arms-out-warmup-line.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Four girls about 7-9 in navy club tops and tracksuit jackets arms out in a warm-up line inside the gym hall",
    "tags": [
      "kids",
      "girls",
      "gymnastics",
      "team",
      "warmup",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/two-girls-holding-hands-club-tops.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Two girls about 7-9 in navy club tops holding hands, a girl in a club tracksuit jacket beside them, gym hall behind",
    "tags": [
      "kids",
      "girls",
      "gymnastics",
      "close-up",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/girls-warmup-line-hall-wide.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Wide view of girls about 7-10 in a long warm-up line with arms out across a gym hall floor, wooden beams behind",
    "tags": [
      "kids",
      "girls",
      "gymnastics",
      "team",
      "warmup",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/smiling-girl-arms-out-warmup.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Smiling girl about 8 in a navy club top with arms out in a warm-up, other girls alongside her in the gym hall",
    "tags": [
      "kids",
      "girls",
      "gymnastics",
      "close-up",
      "warmup",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/rhythmic-team-lineup-leotards.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Group of about 14 girls aged roughly 8-12 in colourful rhythmic gymnastics leotards standing together on the mat in a large hall; clear floor space in front",
    "tags": [
      "girls",
      "gymnastics",
      "team",
      "group",
      "wide",
      "space-bottom",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/girls-holding-hoops-ready.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Girls about 8-11 in orange and blue leotards holding hoops, other gymnasts in leotards lined up behind, red mat edge in front",
    "tags": [
      "kids",
      "girls",
      "gymnastics",
      "hoops",
      "team",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/two-girls-hoops-matching-leotards.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Two girls about 9-11 in matching blue and orange leotards with hoops swirling around them on a hall floor, wooden beams and spectators behind",
    "tags": [
      "kids",
      "girls",
      "gymnastics",
      "hoops",
      "action",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/hoop-squad-routine-hall.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Girls about 9-12 in leotards performing with hoops across a wide mat, a hoop in mid-air above, spectators on benches behind",
    "tags": [
      "kids",
      "girls",
      "gymnastics",
      "hoops",
      "action",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/girl-leaping-hoop-overhead.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Girl about 10 in an orange and blue leotard leaping across the mat with a hoop held overhead, red and blue mat edge in the foreground",
    "tags": [
      "girls",
      "gymnastics",
      "hoops",
      "action",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/girl-hoop-spin-star-jump.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Girl about 10 in a leotard doing a star jump with a hoop on the mat, another gymnast partly in view at left",
    "tags": [
      "girls",
      "gymnastics",
      "hoops",
      "action",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/girl-hoop-jump-rainbow.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Girl about 9-10 in an orange leotard stepping with a rainbow hoop beside her on a large mat, hall windows behind",
    "tags": [
      "girls",
      "gymnastics",
      "hoops",
      "action",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/older-girl-arabesque-black-kit.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Teenage girl in black leggings and top holding an arabesque balance with one leg extended behind her, mat and blue boards in a gym hall",
    "tags": [
      "teen",
      "girls",
      "gymnastics",
      "balance",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/girl-orange-leotard-poised-floor.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Girl about 11-12 in a coral and orange leotard standing poised in the middle of the floor, hands on hips, wide gym hall behind",
    "tags": [
      "girls",
      "gymnastics",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/girl-arabesque-orange-leotard.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Girl about 11-12 in a coral leotard on one leg with the other extended behind in a balance, hall windows behind",
    "tags": [
      "girls",
      "gymnastics",
      "balance",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/girl-green-leotard-floor-routine.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Girl about 10-11 in a green and gold leotard performing a floor routine with arms out, big gym hall behind",
    "tags": [
      "girls",
      "gymnastics",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/girl-green-leotard-high-leg-lift.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Girl about 10-11 in a green and gold leotard leaping with one leg high during a floor routine, hall behind",
    "tags": [
      "girls",
      "gymnastics",
      "action",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/ballet-barre-class-girls-black.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Girls and teens in black practice clothes working along a wooden ballet barre in a warm timber-floored studio",
    "tags": [
      "girls",
      "teen",
      "gymnastics",
      "ballet",
      "team",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/barre-class-girls-teens-portrait.jpg",
    "w": 1069,
    "h": 1600,
    "caption": "Girls and teens in black practice clothes at a ballet barre in a timber-floored studio, a smiling girl in the foreground; portrait view",
    "tags": [
      "girls",
      "teen",
      "gymnastics",
      "ballet",
      "portrait"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/barre-class-windows-long-line.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Long line of gymnasts in black along a wooden barre beside tall frosted windows, a taller girl leading at the front",
    "tags": [
      "girls",
      "teen",
      "gymnastics",
      "ballet",
      "team",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/girls-back-bends-mat-club-tracksuits.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Girls about 8-10 in navy club tracksuits doing back bends on a cream mat, red mat edge in front",
    "tags": [
      "kids",
      "girls",
      "gymnastics",
      "action",
      "wide",
      "space-top",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/girl-jumping-arms-out-mat.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Girl about 7 in a navy top and black shorts jumping with arms out on the mat, navy benches behind; clear wall space above",
    "tags": [
      "kids",
      "girls",
      "gymnastics",
      "action",
      "space-top",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/girl-cartwheel-colourful-boxes.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Girl in navy club kit mid-cartwheel on the mat, colourful foam boxes and benches behind",
    "tags": [
      "kids",
      "girls",
      "gymnastics",
      "action",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/three-girls-jumping-club-tops.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Three girls about 7-9 jumping and bouncing in navy club tops, one mid-air in a white t-shirt, gym hall behind",
    "tags": [
      "kids",
      "girls",
      "gymnastics",
      "action",
      "celebration",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/girl-running-mat-club-tracksuit.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Girl about 7-8 in a navy club tracksuit running across the mat with a determined face, blue padded floor and red mat behind",
    "tags": [
      "kids",
      "girls",
      "gymnastics",
      "action",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/woman-club-jacket-portrait.jpg",
    "w": 1069,
    "h": 1600,
    "caption": "Woman in a navy club tracksuit jacket with red and white sleeves smiling at the camera against a plain light-grey backdrop",
    "tags": [
      "adults",
      "women",
      "coach",
      "portrait"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/adults-contest-ball-blue-6-turf.jpg",
    "w": 1600,
    "h": 1068,
    "caption": "Adults in blue and red shirts contesting the ball on a green turf pitch under evening light",
    "tags": [
      "adults",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/two-players-challenge-blue-pitch.jpg",
    "w": 1600,
    "h": 1068,
    "caption": "Two young men in light-blue shirts competing for a ball on turf, a grandstand and blue railings behind",
    "tags": [
      "adults",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/yellow-kit-striker-mid-strike.jpg",
    "w": 1600,
    "h": 1068,
    "caption": "Man in a yellow shirt striking the ball mid-stride on a turf pitch, teammates in orange behind him",
    "tags": [
      "adults",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/blue-shirt-dribble-evening-game.jpg",
    "w": 1600,
    "h": 1068,
    "caption": "Man in a navy shirt dribbling the ball past a bigger player in a social league game, blue pitch surround behind",
    "tags": [
      "adults",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/light-blue-attacker-lunge.jpg",
    "w": 1600,
    "h": 1068,
    "caption": "Player in a light-blue shirt lunging for the ball in a tangle of legs against a dark fence, turf pitch",
    "tags": [
      "adults",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/blue-and-red-contest-ball.jpg",
    "w": 1600,
    "h": 1068,
    "caption": "Two players in blue and red shirts chasing the ball across the turf with teammates behind, green hills beyond",
    "tags": [
      "adults",
      "action",
      "football",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/players-laughing-by-goalpost-bibs.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Two young men in yellow bibs laughing beside a goalpost with a net behind them and bags on the ground",
    "tags": [
      "adults",
      "football",
      "candid",
      "portrait"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/goalkeeper-yellow-kit-clearance.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Goalkeeper in a yellow shirt and cap kicking the ball clear on a turf pitch, a spectator behind",
    "tags": [
      "adults",
      "action",
      "football",
      "portrait"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/pink-kit-player-dribbling-turf.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Red-haired man in a pink and navy shirt dribbling a ball along the blue line of a turf pitch",
    "tags": [
      "adults",
      "action",
      "football",
      "portrait"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/two-men-tussle-ball-blue-pitch.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Two men in grey-blue and pink shirts shielding and tussling for the ball on turf, blue pitch edge behind",
    "tags": [
      "adults",
      "action",
      "football",
      "portrait"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/player-green-kit-gesture-portrait.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Man with tattoos and a shaved head in a green patterned shirt looking down at the ball and gesturing on a turf pitch",
    "tags": [
      "adults",
      "football",
      "close-up",
      "portrait"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/ball-close-up-blue-line-turf.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Close-up of a patterned football on a white line beside blue turf with a player boot at left; plenty of clear grass and blue space",
    "tags": [
      "football",
      "close-up",
      "space-right",
      "portrait"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/goalkeeper-kicking-long-evening.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Goalkeeper in a dark top and gloves kicking the ball long on the pitch, other players and goals blurred behind",
    "tags": [
      "adults",
      "action",
      "football",
      "portrait"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/smiling-player-heart-hands-sky-blue-kit.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Smiling young man in a sky-blue and yellow striped shirt making a heart shape with his hands in front of his chest, teammates behind",
    "tags": [
      "adults",
      "football",
      "celebration",
      "close-up",
      "portrait"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/player-orange-bib-dribbling-dusk.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Man in an orange bib dribbling the ball at dusk in front of a goal, referee behind",
    "tags": [
      "adults",
      "action",
      "football",
      "portrait"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/three-players-battle-for-ball-dusk.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Three men in cream and black shirts battling for the ball in front of a goal at dusk",
    "tags": [
      "adults",
      "action",
      "football",
      "portrait"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/player-green-kit-ball-control-dusk.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Man in a green shirt controlling the ball on a turf pitch at dusk, white fence behind",
    "tags": [
      "adults",
      "football",
      "portrait"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/yellow-shirt-player-dribbling-dusk.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Man in a yellow and green number 12 shirt dribbling a ball with a stand and dugout behind",
    "tags": [
      "adults",
      "action",
      "football",
      "portrait"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/social-league-curly-hair-player-strike.jpg",
    "w": 1600,
    "h": 1192,
    "caption": "Smiling man with curly hair in a grey top lashing a football with players in bibs blurred behind on a night pitch",
    "tags": [
      "adults",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/social-league-red-kit-player-turf-night.jpg",
    "w": 1202,
    "h": 1365,
    "caption": "Man in a red shirt and black shorts moving across a bright turf pitch at night, goal and players behind",
    "tags": [
      "adults",
      "action",
      "football",
      "portrait"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/night-game-floodlit-pitch-goal.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Man in a light-blue bib passing a ball on a floodlit turf pitch at night, goal behind; dark space at the top",
    "tags": [
      "adults",
      "football",
      "night",
      "space-top",
      "landscape"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/term-champions-group-banner-goal.jpg",
    "w": 1600,
    "h": 1200,
    "caption": "Seven adult men standing together in front of a goal holding a United Sports Centre Champions banner on turf",
    "tags": [
      "adults",
      "team",
      "group",
      "celebration",
      "landscape"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/blue-kit-attacker-open-pitch.jpg",
    "w": 1600,
    "h": 1068,
    "caption": "Teenage player in a light-blue kit shooting on a turf pitch with other players and goals behind",
    "tags": [
      "adults",
      "youth",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/blue-and-yellow-players-contest.jpg",
    "w": 1600,
    "h": 1068,
    "caption": "Young players in blue patterned and bright-coloured shirts contesting the ball, a bib-wearing player behind",
    "tags": [
      "adults",
      "youth",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/boys-youth-league-goalkeeper-kick.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Boy about 9 in white goalkeeper kit kicking the ball out from a goal with a blue wall behind",
    "tags": [
      "kids",
      "boys",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/boy-youth-league-white-kit-sponsor.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Red-haired boy about 8-9 in a white and blue kit crouching ready beside a green perimeter board on a sunny turf pitch",
    "tags": [
      "kids",
      "boys",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/boys-youth-league-contest-sunny.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Boys about 9-10 in blue and white kits jostling for the ball by a green perimeter board on a sunny turf pitch",
    "tags": [
      "kids",
      "boys",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/u15-final-yellow-v-navy-crowd-action.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Teenage players in yellow and navy kits contesting the ball on a green pitch with a crowd behind blue railings during a tournament final",
    "tags": [
      "youth",
      "action",
      "football",
      "tournament",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/u15-final-navy-13-v-yellow-wide.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Wide match action: a yellow-kit teen dribbling past a navy number 13 with a packed crowd behind the blue railings",
    "tags": [
      "youth",
      "action",
      "football",
      "tournament",
      "crowd",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/u15-final-teams-walk-out-cic-arch.jpg",
    "w": 1067,
    "h": 1600,
    "caption": "Yellow-kit teenage team and a goalkeeper in pink walking out under the green Christchurch International Cup arch; portrait view",
    "tags": [
      "youth",
      "team",
      "tournament",
      "portrait"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/u15-final-yellow-v-navy-tackle-portrait.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Teenage player in yellow shielding the ball from a navy-kit opponent on a green pitch; portrait view",
    "tags": [
      "youth",
      "action",
      "football",
      "tournament",
      "portrait"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/u15-final-ref-pink-scramble-portrait.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Scramble for the ball between yellow and navy teenage players with a referee in pink behind; portrait view",
    "tags": [
      "youth",
      "action",
      "football",
      "tournament",
      "portrait"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/u15-final-navy-team-huddle.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Teenage players in navy kits and a goalkeeper in grey in a tight huddle on a green pitch, spectators behind",
    "tags": [
      "youth",
      "team",
      "football",
      "tournament",
      "celebration",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/u15-final-yellow-player-kneeling-ball.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Teenage player in a yellow kit kneeling on the grass with arms out and a confident look, crowd behind blue railings; portrait view",
    "tags": [
      "youth",
      "football",
      "tournament",
      "portrait"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/blue-team-champions-trophy-lift-arch.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Boys in royal blue kits and coaches under the Christchurch International Cup arch lifting a trophy beside a Champions 2025 board at dusk",
    "tags": [
      "youth",
      "team",
      "tournament",
      "celebration",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/yellow-black-team-trophy-lift-arch.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Boys in yellow and black striped kits celebrating with a raised trophy under the Christchurch International Cup arch at dusk",
    "tags": [
      "youth",
      "team",
      "tournament",
      "celebration",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/red-team-arms-up-trophy-arch.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Boys in red kits cheering with arms raised and a trophy lifted under the Christchurch International Cup arch at dusk",
    "tags": [
      "youth",
      "team",
      "tournament",
      "celebration",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/presenter-boy-golden-ball-award-dusk.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Man in a dark suit giving a thumbs-up beside a teenage player in a blue club jacket holding a golden ball award at dusk",
    "tags": [
      "youth",
      "tournament",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/champions-2024-trophy-lift-banner.jpg",
    "w": 1600,
    "h": 1076,
    "caption": "Boys in red and black kits cheering with arms raised and trophies above a Champions 2024 banner in front of a goal",
    "tags": [
      "youth",
      "team",
      "tournament",
      "celebration",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/runners-up-red-team-celebrate-2024.jpg",
    "w": 1600,
    "h": 1076,
    "caption": "Boys in red and black kits celebrating with arms raised and a shield, kneeling team in front, pull-up banners behind",
    "tags": [
      "youth",
      "team",
      "tournament",
      "celebration",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/third-place-red-team-lineup-2024.jpg",
    "w": 1600,
    "h": 1076,
    "caption": "Team of boys in red shirts and green shorts lined up with a shield in front of a goal and pull-up banners",
    "tags": [
      "youth",
      "team",
      "tournament",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/black-kit-team-plate-winners-pull-up.jpg",
    "w": 1600,
    "h": 1076,
    "caption": "Boys in black tracksuits kneeling and standing in a team photo holding a plate in front of a blue pull-up banner",
    "tags": [
      "youth",
      "team",
      "tournament",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/navy-and-orange-players-ball-sunny.jpg",
    "w": 1600,
    "h": 1064,
    "caption": "Teenage players in navy and orange red-striped shirts moving together on a sunny day, event tent behind",
    "tags": [
      "youth",
      "action",
      "football",
      "tournament",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/summer-7s-trophies-on-table-turf.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Two gold cups on a white table with a medal on a blue and green turf pitch, players blurred in the distance; clear space at the top",
    "tags": [
      "tournament",
      "venue",
      "close-up",
      "space-top",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/summer-7s-champions-arch-black-team.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Group of adult players in black holding a large cheque under the green Christchurch International Cup arch with a Champions 2026 board",
    "tags": [
      "adults",
      "team",
      "tournament",
      "celebration",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/summer-7s-champions-arch-green-team.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Adult team in green and white striped shirts holding a cheque under the green Christchurch International Cup arch, Champions 2026 board",
    "tags": [
      "adults",
      "team",
      "tournament",
      "celebration",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/summer-7s-players-high-five-line.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Adult players in light-blue and yellow shirts greeting each other in a long handshake line on a turf pitch",
    "tags": [
      "adults",
      "tournament",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/summer-7s-team-crouch-smiles-light-blue.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Adult team in light-blue and yellow shirts crouching and smiling with footballs on a grass pitch",
    "tags": [
      "adults",
      "team",
      "tournament",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/summer-7s-goalkeeper-dive-save.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Goalkeeper in black diving at the feet of an attacker in white as players in red look on, blue pitch boards behind",
    "tags": [
      "adults",
      "action",
      "football",
      "tournament",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/summer-7s-players-contest-ball-wide.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Wide view of adult players in light-blue, white and grey kits contesting the ball across a turf pitch",
    "tags": [
      "adults",
      "action",
      "football",
      "tournament",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/summer-7s-orange-shirts-play.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Adult players in orange shirts and a man in a blue bib chasing the ball in a 7-a-side game on turf",
    "tags": [
      "adults",
      "action",
      "football",
      "tournament",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/summer-7s-two-players-jostle.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Two adult players, one in black and one in navy and red, jostling as a ball drops from above on a turf pitch",
    "tags": [
      "adults",
      "action",
      "football",
      "tournament",
      "landscape"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/u11-boys-dribble-blue-v-white.jpg",
    "w": 1080,
    "h": 1350,
    "caption": "Boy about 10 in a blue kit dribbling past a boy in a white number 6 shirt, spectators behind a fence; portrait view",
    "tags": [
      "kids",
      "boys",
      "action",
      "football",
      "tournament",
      "portrait"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/u11-boy-volley-blue-kit.jpg",
    "w": 1080,
    "h": 1350,
    "caption": "Boy about 10 in a blue kit kicking the ball in a challenge with a boy in white number 18, goal behind; portrait view",
    "tags": [
      "kids",
      "boys",
      "action",
      "football",
      "tournament",
      "portrait"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/u11-team-huddle-white-bibs.jpg",
    "w": 1080,
    "h": 1350,
    "caption": "Young players in white kits and pink and yellow bibs in a tight team huddle, green perimeter board behind; portrait view",
    "tags": [
      "kids",
      "team",
      "football",
      "tournament",
      "celebration",
      "portrait"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/player-walking-out-tunnel-black-kit-stadium.jpg",
    "w": 1600,
    "h": 1280,
    "caption": "Player in a black and gold South Island United shirt with a sponsor logo walking out at a stadium, a boy escort at the edge of frame",
    "tags": [
      "adults",
      "football",
      "matchday",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/midfielder-dribbling-black-kit-green-turf.jpg",
    "w": 1600,
    "h": 1280,
    "caption": "Midfielder in a black and gold kit dribbling the ball upfield as opponents in light blue and red chase, stadium boards behind",
    "tags": [
      "adults",
      "action",
      "football",
      "matchday",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/player-striking-ball-black-kit-stadium.jpg",
    "w": 1600,
    "h": 1280,
    "caption": "Player in a black kit playing the ball with the inside of his boot on a green pitch, empty stand behind",
    "tags": [
      "adults",
      "action",
      "football",
      "matchday",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/player-carrying-ball-black-kit-wide-stand.jpg",
    "w": 1600,
    "h": 1280,
    "caption": "Player in a black kit running with the ball on a green pitch, empty stand behind; wide shot with space around him",
    "tags": [
      "adults",
      "football",
      "matchday",
      "wide",
      "space-top",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/player-close-up-black-kit-matchday.jpg",
    "w": 1600,
    "h": 1280,
    "caption": "Close-up of a curly-haired player in a black and gold shirt looking down, blurred crowd in the stands behind",
    "tags": [
      "adults",
      "football",
      "matchday",
      "close-up",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/player-with-bib-walking-pitch-night.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Player in a black kit walking off the pitch with a staff member in a green bib, crowd in the stand behind; portrait view",
    "tags": [
      "adults",
      "football",
      "matchday",
      "portrait"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/player-volley-black-kit-v-light-blue.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Player in black kicking the ball at head height against a defender in light blue, sponsor boards behind",
    "tags": [
      "adults",
      "action",
      "football",
      "matchday",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/goalkeeper-training-black-kit-sunny-pitch.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Goalkeeper in an all-black kit with gloves standing on a sunny pitch with a dugout and blue railings behind",
    "tags": [
      "adults",
      "football",
      "training",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/goalkeepers-talk-training-turf.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Two players in black training kit talking on a sunny pitch, dugout and blue railings behind",
    "tags": [
      "adults",
      "football",
      "training",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/two-players-training-walk-blue-pitch.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Two players in black training kit walking across a sunny pitch, a marquee behind",
    "tags": [
      "adults",
      "football",
      "training",
      "wide",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/gym-pull-ups-black-training-kit.jpg",
    "w": 1069,
    "h": 1600,
    "caption": "Player doing a pull-up on a rig in a gym while a teammate watches, both in black training kit; portrait view",
    "tags": [
      "adults",
      "training",
      "gym",
      "portrait"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/four-people-black-kit-gym-arms-crossed.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Four people in black training kit standing with arms crossed in a large industrial gym",
    "tags": [
      "adults",
      "training",
      "gym",
      "team",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/four-people-training-kit-gym-wall-logo.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Four people in black training kit lined up in front of a gym wall with a circular logo",
    "tags": [
      "adults",
      "training",
      "gym",
      "team",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/player-arms-crossed-white-tee-stadium-boards.jpg",
    "w": 1600,
    "h": 1200,
    "caption": "Smiling man in a white t-shirt with arms crossed standing on a pitch in front of a stand and club boards",
    "tags": [
      "adults",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/player-signing-contract-smiling-trophy-shelves.jpg",
    "w": 1200,
    "h": 1600,
    "caption": "Smiling man in a white t-shirt signing a document at a wooden desk with a shelf of trophies behind him; portrait view",
    "tags": [
      "adults",
      "signing",
      "portrait"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/player-portrait-black-training-tee-grey-wall.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Young man in a black training t-shirt standing against a pale wall, front-on portrait",
    "tags": [
      "adults",
      "landscape"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/player-portrait-black-tee-neutral-wall.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Young man in a black t-shirt standing against a pale wall, front-on portrait",
    "tags": [
      "adults",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/kids-holiday-camp-toy-world-cup-trophy-goal.jpg",
    "w": 750,
    "h": 500,
    "caption": "Five boys about 8-10 laughing and cheering with arms up, one holding a toy World Cup trophy, standing in a goal with the net behind them",
    "tags": [
      "kids",
      "boys",
      "celebration",
      "holiday",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/kids-watch-from-stand-world-flags.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Children about 7-10 in yellow bibs watching from a blue grandstand draped with national flags during a holiday camp",
    "tags": [
      "kids",
      "holiday",
      "crowd",
      "venue",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/kids-small-sided-game-yellow-bibs-holiday.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Boys about 7-9 in yellow bibs and red socks playing a small-sided game on a turf pitch, a yellow ball at their feet",
    "tags": [
      "kids",
      "boys",
      "action",
      "football",
      "holiday",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/teen-boys-contest-ball-yellow-bib.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Teenage boys about 14-16, one in a blue club kit and one in a yellow bib, challenging for the ball on a turf pitch; portrait view",
    "tags": [
      "youth",
      "teen",
      "action",
      "football",
      "portrait"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/academy-player-running-blue-kit-goalmouth.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Teenage player in a blue club training top running in front of a goal, blue pitch surround and a corner flag behind",
    "tags": [
      "youth",
      "teen",
      "football",
      "close-up",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/first-team-player-dribbling-blue-kit-hills.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Player in a blue first-team kit with a leg strapped dribbling the ball, hills and a roof behind him; portrait view",
    "tags": [
      "adults",
      "action",
      "football",
      "matchday",
      "portrait"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/first-team-blue-11-v-yellow-chase.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Player in blue number 11 chasing a yellow-kit opponent for the ball on a turf pitch, sponsor boards behind",
    "tags": [
      "adults",
      "action",
      "football",
      "matchday",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/first-team-tackle-blue-3-v-yellow.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Blue number 3 and a yellow-kit player competing for the ball in a tackle on a turf pitch",
    "tags": [
      "adults",
      "action",
      "football",
      "matchday",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/first-team-player-fusion-shirt-close-up.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Player in a blue first-team shirt with an orange sponsor logo looking at the camera against a dark background",
    "tags": [
      "adults",
      "football",
      "matchday",
      "close-up",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/first-team-player-white-away-sideline-portrait.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Young player in a white away shirt with blue trim watching the game at the sideline, a player in an orange bib beside him; portrait view",
    "tags": [
      "adults",
      "football",
      "matchday",
      "close-up",
      "portrait"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/first-team-white-away-2-dribbling.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Player in a white away kit dribbling the ball on green turf, hillside and a club banner behind; portrait view",
    "tags": [
      "adults",
      "action",
      "football",
      "matchday",
      "portrait"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/first-team-white-away-group-celebration.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Players in white away kits gathered in a group celebration on a green pitch behind a fence; portrait view",
    "tags": [
      "adults",
      "team",
      "celebration",
      "football",
      "matchday",
      "portrait"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/first-team-players-embrace-white-away.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Two players in white away shirts hugging in a close embrace after a goal",
    "tags": [
      "adults",
      "celebration",
      "football",
      "matchday",
      "close-up",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/first-team-celebration-lifted-number-6.jpg",
    "w": 1200,
    "h": 1600,
    "caption": "Blue-kit players lifting a team-mate wearing number 6 high into a blue sky in a joyful celebration; portrait view",
    "tags": [
      "adults",
      "celebration",
      "football",
      "matchday",
      "portrait"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/u17-style-match-black-v-yellow-duel.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Young player in black dribbling a ball past a yellow-kit opponent on a grass pitch with spectators and a clubhouse behind",
    "tags": [
      "youth",
      "action",
      "football",
      "crowd",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/children-huddle-orange-bibs-close.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Close-up of children about 6-8 in orange bibs and blue club tops crowded together smiling on a grass pitch",
    "tags": [
      "kids",
      "team",
      "close-up",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/girl-kicking-yellow-bib-goalmouth-sunny.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Girl about 8 in a yellow bib kicking a ball on a turf pitch in front of a goal with blue railings behind",
    "tags": [
      "kids",
      "girls",
      "action",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/girl-7-club-tee-portrait-grey-backdrop.jpg",
    "w": 1200,
    "h": 1600,
    "caption": "Smiling girl about 7 in a navy United Gymnastics t-shirt standing against a plain grey backdrop",
    "tags": [
      "kids",
      "girls",
      "gymnastics",
      "portrait"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/girl-9-club-tee-smiling-portrait.jpg",
    "w": 1200,
    "h": 1600,
    "caption": "Smiling girl about 9 in a navy United Gymnastics t-shirt against a plain grey backdrop",
    "tags": [
      "kids",
      "girls",
      "gymnastics",
      "portrait"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/girl-9-club-tee-ponytail-portrait.jpg",
    "w": 1200,
    "h": 1600,
    "caption": "Smiling girl about 9 with her hair in a high bun in a navy United Gymnastics t-shirt against a plain grey backdrop",
    "tags": [
      "kids",
      "girls",
      "gymnastics",
      "portrait"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/teen-girl-club-jacket-portrait.jpg",
    "w": 1200,
    "h": 1600,
    "caption": "Girl about 12 with her hair in a bun wearing a navy United Gymnastics tracksuit jacket with red sleeves against a grey backdrop",
    "tags": [
      "girls",
      "teen",
      "gymnastics",
      "portrait"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/first-team-blue-kit-shot-v-white-wide.jpg",
    "w": 1600,
    "h": 1068,
    "caption": "Player in a blue first-team kit striking the ball as opponents in white close in, sponsor boards and a grassy bank behind",
    "tags": [
      "adults",
      "action",
      "football",
      "matchday",
      "landscape"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/first-team-players-gather-fusion-shirts.jpg",
    "w": 1600,
    "h": 1068,
    "caption": "Players in blue first-team shirts and white opponents gather during a stoppage, a captain wearing an armband at centre",
    "tags": [
      "adults",
      "football",
      "matchday",
      "landscape"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/stadium-pitch-crowd-in-stand-wide.jpg",
    "w": 1600,
    "h": 1069,
    "caption": "Wide view across a turf pitch to a stand with a seated crowd, green sponsor boards and a Christchurch International Cup board",
    "tags": [
      "venue",
      "crowd",
      "wide",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/match-on-turf-pitch-stand-behind-wide.jpg",
    "w": 1600,
    "h": 1068,
    "caption": "Match in progress on a turf pitch, players in blue and white, a blue stand and green trees behind",
    "tags": [
      "venue",
      "wide",
      "football",
      "action",
      "landscape"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/match-on-turf-pitch-hillside-wide.jpg",
    "w": 1600,
    "h": 1068,
    "caption": "Wide match view on a blue-edged turf pitch with a grassy hillside, goals and a fence behind",
    "tags": [
      "venue",
      "wide",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/goal-net-foreground-turf-pitch-match.jpg",
    "w": 1600,
    "h": 1068,
    "caption": "View through a goal net across a turf pitch with a match at right and a referee in pink, blue-fenced surround",
    "tags": [
      "venue",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/empty-stand-blue-seats-cup-board.jpg",
    "w": 1600,
    "h": 1200,
    "caption": "Empty blue and grey stand above a Christchurch International Cup board and the white halfway line on the turf, trees behind",
    "tags": [
      "venue",
      "wide",
      "football",
      "landscape"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/wide-grass-pitch-cloudy-sky.jpg",
    "w": 1600,
    "h": 1200,
    "caption": "Wide view of a turf pitch under a cloudy sky with a game at the far end, floodlights and trees along the edge; large sky above",
    "tags": [
      "venue",
      "wide",
      "football",
      "space-top",
      "landscape"
    ]
  },
  {
    "brand": "usg",
    "src": "https://app.usg.co.nz/mailer/usg/lib/staff-group-grey-polos-stand-and-dog.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Nine staff in grey club polos and navy trousers lined up in front of a stand with a German shepherd in a blue shirt sitting at the front",
    "tags": [
      "adults",
      "team",
      "group",
      "venue",
      "landscape"
    ]
  },
  {
    "brand": "usg",
    "src": "https://app.usg.co.nz/mailer/usg/lib/club-dog-in-blue-shirt-on-pitch.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "German shepherd wearing a blue club shirt sitting on the turf at the halfway line, empty stand and trees behind",
    "tags": [
      "close-up",
      "venue",
      "landscape"
    ]
  },
  {
    "brand": "usg",
    "src": "https://app.usg.co.nz/mailer/usg/lib/staff-member-polo-smiling-pitch-portrait.jpg",
    "w": 1600,
    "h": 1067,
    "caption": "Smiling bearded man in a grey club polo standing on a turf pitch with goals and trees behind him",
    "tags": [
      "adults",
      "coach",
      "landscape"
    ]
  },
  {
    "brand": "usg",
    "src": "https://app.usg.co.nz/mailer/usg/lib/business-event-two-men-talking.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Two men in blazers talking with drinks at an evening business event; portrait view",
    "tags": [
      "adults",
      "event",
      "portrait"
    ]
  },
  {
    "brand": "usg",
    "src": "https://app.usg.co.nz/mailer/usg/lib/business-event-speaker-presentation.jpg",
    "w": 1280,
    "h": 1600,
    "caption": "Man in a dark suit presenting beside a screen and a pull-up banner of club logos at a business event; portrait view",
    "tags": [
      "adults",
      "event",
      "portrait"
    ]
  },
  // ── From the club's own photo archive on the NAS (2026-11-01): scored by Haiku, checked by Sonnet,
  // looked over by eye; no solo close-ups of children; 1800 px, no EXIF/GPS. Files: lib/nas-*.jpg.
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u14-team-huddle-grass-pitch.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A group of youth players in blue kits and a goalkeeper in yellow stand in a tight team huddle with arms around each other on a grass pitch with trees behind; open grass across the bottom.",
    "tags": [
      "landscape",
      "team",
      "youth",
      "boys",
      "football",
      "tournament",
      "matchday",
      "space-bottom"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u14-header-contest-willow-trees.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Two boys, one in blue and one in red, challenge for a header on a grass pitch with spectators and willow trees behind; soft blurred trees along the left side.",
    "tags": [
      "landscape",
      "action",
      "youth",
      "boys",
      "football",
      "tournament",
      "matchday",
      "space-left"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u17-player-dribbling-turf-pitch.jpg",
    "w": 1080,
    "h": 1350,
    "caption": "A teen player in a blue kit dribbles a ball across a turf pitch in bright daylight with a blurred goal behind; soft blurred background across the top.",
    "tags": [
      "portrait",
      "action",
      "teen",
      "boys",
      "football",
      "matchday",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u12-team-trophy-celebration.jpg",
    "w": 1800,
    "h": 1350,
    "caption": "Boys in blue kits with medals cheer with arms raised as one holds a trophy aloft, with coaches beside them on a grass field; open blue sky above the group.",
    "tags": [
      "landscape",
      "celebration",
      "team",
      "kids",
      "boys",
      "coach",
      "football",
      "tournament",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-young-goalkeeper-full-stretch-dive.jpg",
    "w": 1600,
    "h": 1068,
    "caption": "A young goalkeeper in a green kit dives full stretch towards a ball in the goal mouth in bright sun; turf across the bottom.",
    "tags": [
      "landscape",
      "action",
      "kids",
      "boys",
      "football",
      "matchday",
      "space-bottom"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u19-aerial-challenge-hillside-match.jpg",
    "w": 1440,
    "h": 1800,
    "caption": "Two players jump for a high ball in mid-air during a sunny match, with a hillside and trees behind; hillside and sky across the top.",
    "tags": [
      "portrait",
      "action",
      "teen",
      "boys",
      "football",
      "matchday",
      "tournament",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u19-players-embrace-celebration-sunny.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Two smiling players in white kits embrace and celebrate on a sunny pitch with other players behind; clear blue sky across the top.",
    "tags": [
      "landscape",
      "celebration",
      "teen",
      "boys",
      "football",
      "matchday",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u19-heart-hands-goal-celebration.jpg",
    "w": 1440,
    "h": 1800,
    "caption": "A smiling player in a white kit makes a heart shape with his hands on a bright pitch while a teammate runs behind; soft blurred greenery across the top.",
    "tags": [
      "portrait",
      "celebration",
      "teen",
      "boys",
      "football",
      "matchday",
      "candid",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-smiling-player-peace-sign-white-sky.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A smiling player in a white and blue kit winks and makes a peace sign against a bright white sky; clear white space across the top and right.",
    "tags": [
      "landscape",
      "close-up",
      "celebration",
      "candid",
      "adults",
      "football",
      "space-top",
      "space-right"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-three-players-goal-celebration-hug.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Three players in white and blue kits embrace in a goal celebration in daylight in front of a dark building; plain grey sky across the top strip.",
    "tags": [
      "landscape",
      "celebration",
      "team",
      "matchday",
      "adults",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-teammate-lifted-aloft-blue-sky.jpg",
    "w": 1440,
    "h": 1800,
    "caption": "Players in blue kits lift a teammate into the air in celebration under bright sun; clear blue sky across the top third.",
    "tags": [
      "portrait",
      "celebration",
      "team",
      "matchday",
      "adults",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-smiling-player-white-kit-daylight.jpg",
    "w": 1080,
    "h": 1350,
    "caption": "A smiling player in a white kit with a sponsor logo looks off to the side in bright daylight; soft blurred green background on the left.",
    "tags": [
      "portrait",
      "close-up",
      "candid",
      "matchday",
      "adults",
      "football",
      "space-left"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-youth-player-dribbling-low-sun.jpg",
    "w": 800,
    "h": 622,
    "caption": "A youth player in blue kit dribbles a ball across turf in low sunlight with a blue fence and dark hedge behind; open turf across the lower half.",
    "tags": [
      "landscape",
      "action",
      "youth",
      "girls",
      "matchday",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-youth-players-racing-for-ball.jpg",
    "w": 800,
    "h": 622,
    "caption": "A player in red and a player in blue run side by side for a loose ball on a turf pitch in soft daylight; clear turf across the bottom third.",
    "tags": [
      "landscape",
      "action",
      "youth",
      "teen",
      "matchday",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-youth-dribbler-long-shadows-turf.jpg",
    "w": 800,
    "h": 622,
    "caption": "A youth player in blue kit dribbles a ball on green turf with long shadows and blurred spectators behind; clean open turf across the bottom third.",
    "tags": [
      "landscape",
      "action",
      "youth",
      "kids",
      "matchday",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-youth-dribbling-past-red-opponent.jpg",
    "w": 800,
    "h": 622,
    "caption": "A youth player in blue kit dribbles past an opponent in red on a turf pitch in bright daylight with a blue railing behind; clear grass across the bottom.",
    "tags": [
      "landscape",
      "action",
      "youth",
      "teen",
      "matchday",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-blue-player-shielding-ball-tournament.jpg",
    "w": 1200,
    "h": 1800,
    "caption": "A player in blue shields the ball from a red-kitted opponent seen from behind, with blurred green trees behind; soft green tree backdrop across the top third.",
    "tags": [
      "portrait",
      "action",
      "tournament",
      "youth",
      "teen",
      "matchday",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u17-blue-kit-goal-celebration.jpg",
    "w": 1800,
    "h": 1610,
    "caption": "Teen players in blue kits celebrate together on a turf pitch, smiling and reaching out to one another; plain grass across the bottom.",
    "tags": [
      "landscape",
      "celebration",
      "team",
      "teen",
      "boys",
      "football",
      "matchday",
      "space-bottom"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u17-white-kit-hug-celebration.jpg",
    "w": 1080,
    "h": 1350,
    "caption": "Three teen players in white kits with blue trim hug in celebration on a green turf pitch with a fence behind; dark backdrop across the top fifth.",
    "tags": [
      "portrait",
      "celebration",
      "team",
      "teen",
      "boys",
      "football",
      "matchday",
      "candid",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u17-blue-kit-high-fives-sunny.jpg",
    "w": 1800,
    "h": 1130,
    "caption": "A group of teen players in blue kits high-five on a blue-edged pitch in sunshine with goals and a stand behind; open turf across the bottom.",
    "tags": [
      "landscape",
      "wide",
      "celebration",
      "team",
      "teen",
      "boys",
      "football",
      "matchday",
      "space-bottom"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u17-blue-team-huddle-prematch.jpg",
    "w": 1796,
    "h": 1800,
    "caption": "A team in blue kits stands in a huddle with arms around each other, seen from behind, before a daytime match; clear sky across the top third.",
    "tags": [
      "square",
      "team",
      "teen",
      "boys",
      "football",
      "matchday",
      "warmup",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u17-player-dribbling-towards-camera.jpg",
    "w": 1080,
    "h": 1350,
    "caption": "A teen player in a blue kit runs with the ball towards the camera on bright artificial turf; soft blurred turf across the top.",
    "tags": [
      "portrait",
      "action",
      "teen",
      "boys",
      "football",
      "matchday",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u20-player-striking-ball-turf.jpg",
    "w": 1800,
    "h": 1440,
    "caption": "A young player in a blue kit strikes a ball on an artificial pitch with a small stand of spectators behind; pale sky across the top third.",
    "tags": [
      "landscape",
      "action",
      "youth",
      "boys",
      "football",
      "matchday",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u20-squad-line-up-tournament.jpg",
    "w": 1600,
    "h": 748,
    "caption": "A squad of young players in blue kits stands in a line with staff on a grass pitch beneath trees; grey sky across the top.",
    "tags": [
      "landscape",
      "wide",
      "team",
      "youth",
      "boys",
      "football",
      "tournament",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-boy-white-kit-dribbling-sunny-pitch.jpg",
    "w": 1600,
    "h": 1305,
    "caption": "A boy in a white kit dribbles a ball across a sunny grass pitch with a blue-kitted opponent softly blurred behind; plain grass across the bottom.",
    "tags": [
      "landscape",
      "action",
      "youth",
      "boys",
      "football",
      "tournament",
      "space-bottom"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-teen-players-contest-ball-daylight.jpg",
    "w": 1080,
    "h": 1350,
    "caption": "Two teenage players, one in white and one in blue, contest a ball on a grass pitch in bright sun; soft green background across the top.",
    "tags": [
      "portrait",
      "action",
      "youth",
      "teen",
      "boys",
      "football",
      "matchday",
      "tournament",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-girls-chasing-ball-sunny-turf.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Several girls in blue and yellow bibs chase a ball across a sunny artificial pitch, seen mostly from behind; soft-focus background across the top third.",
    "tags": [
      "landscape",
      "action",
      "kids",
      "girls",
      "football",
      "training",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-coach-tying-child-boot-turf.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A coach in black crouches on turf to tie the boot of a child in a blue shirt, with a ball beside them; plain blue wall across the top right.",
    "tags": [
      "landscape",
      "coach",
      "training",
      "kids",
      "candid",
      "football",
      "space-right"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-three-boys-chasing-yellow-ball.jpg",
    "w": 1000,
    "h": 667,
    "caption": "Three boys in blue kits chase a yellow ball across bright green turf in low winter light; soft plain wall across the top.",
    "tags": [
      "landscape",
      "action",
      "kids",
      "youth",
      "boys",
      "training",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-boy-blue-kit-dribbling-orange-ball.jpg",
    "w": 1202,
    "h": 1800,
    "caption": "A boy in a blue kit dribbles an orange ball on artificial turf in overcast daylight, with other players blurred behind; open turf across the bottom.",
    "tags": [
      "portrait",
      "action",
      "youth",
      "boys",
      "training",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-boy-blue-kit-striking-ball-sunny.jpg",
    "w": 1080,
    "h": 1350,
    "caption": "A boy in a blue kit with a sponsor logo strikes a white and blue ball on a blue-lined turf pitch in bright daylight; plain white wall across the top left.",
    "tags": [
      "portrait",
      "action",
      "youth",
      "boys",
      "training",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-girl-dribbling-past-black-kit.jpg",
    "w": 1800,
    "h": 1211,
    "caption": "A girl in blue dribbles a ball past a player in black during a youth match on a turf pitch in clear daylight; open turf across the bottom.",
    "tags": [
      "landscape",
      "action",
      "matchday",
      "youth",
      "girls",
      "boys",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-girl-blue-tracksuit-dribbling-overcast.jpg",
    "w": 1200,
    "h": 1800,
    "caption": "A girl in a blue tracksuit top and shorts dribbles a ball on a turf pitch in soft overcast light, with players and trees blurred behind; blurred trees and grass bank across the top.",
    "tags": [
      "portrait",
      "action",
      "warmup",
      "youth",
      "girls",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-girl-striking-ball-turf-pitch.jpg",
    "w": 1200,
    "h": 1800,
    "caption": "A girl in a blue kit strikes a ball with her left foot on a turf pitch, with a goal and a player in green behind her; soft tree-line and goal across the top for text.",
    "tags": [
      "portrait",
      "action",
      "matchday",
      "kids",
      "youth",
      "girls",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-boys-chase-ball-before-goal.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A boy in a green striped kit and a boy in blue chase the ball on a turf pitch in front of a goal; plain goal netting across the top.",
    "tags": [
      "landscape",
      "action",
      "matchday",
      "kids",
      "youth",
      "boys",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-coach-huddle-academy-boys-turf.jpg",
    "w": 1616,
    "h": 1080,
    "caption": "A coach in a grey beanie talks with a huddle of boys in blue academy kits on a turf pitch; dark fence line and trees across the top.",
    "tags": [
      "landscape",
      "coach",
      "team",
      "training",
      "kids",
      "youth",
      "boys",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-coach-talks-seated-boys-blue-sky.jpg",
    "w": 1080,
    "h": 1350,
    "caption": "A coach sits on a turf pitch talking with boys seated on the grass while other players spread out in the distance; clear blue sky across the top.",
    "tags": [
      "portrait",
      "coach",
      "training",
      "kids",
      "youth",
      "boys",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-blue-squad-medals-trophy-field.jpg",
    "w": 1800,
    "h": 1350,
    "caption": "A squad of boys in blue kits with medals holds a trophy beside two coaches on a grass field; narrow band of blue sky across the top.",
    "tags": [
      "landscape",
      "team",
      "celebration",
      "tournament",
      "coach",
      "kids",
      "youth",
      "boys",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-boys-raise-trophy-blue-sky.jpg",
    "w": 1800,
    "h": 1350,
    "caption": "Boys in blue kits raise a trophy and cheer with a coach on grass under a blue sky; clear sky in the top left corner.",
    "tags": [
      "landscape",
      "team",
      "celebration",
      "tournament",
      "coach",
      "kids",
      "youth",
      "boys",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u12-boy-dribbling-past-opponents.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A boy in a blue kit dribbles the ball while two black-and-white striped opponents chase him on a sunny grass pitch; open grass along the bottom edge.",
    "tags": [
      "landscape",
      "action",
      "matchday",
      "tournament",
      "kids",
      "boys",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-academy-prizegiving-trophies-banners.jpg",
    "w": 1350,
    "h": 1800,
    "caption": "Two boys in blue kits hold small trophies between two smiling men in grey tops in front of club banners at a prizegiving; plain dark wall across the top.",
    "tags": [
      "portrait",
      "team",
      "kids",
      "boys",
      "coach",
      "event",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u18-teen-dribbling-white-kit.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A teenage player in a white kit dribbles the ball across a turf pitch in daylight in front of a plain concrete wall; open turf across the bottom.",
    "tags": [
      "landscape",
      "action",
      "matchday",
      "teen",
      "youth",
      "boys",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-boy-orange-bib-striking-ball.jpg",
    "w": 1080,
    "h": 1350,
    "caption": "A boy in an orange bib, seen from behind, strikes a ball on a turf pitch while other players train in the background; open turf at the lower right.",
    "tags": [
      "portrait",
      "action",
      "training",
      "kids",
      "boys",
      "football",
      "space-right"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u13-white-kit-dribbling-selwyn.jpg",
    "w": 1080,
    "h": 1350,
    "caption": "A boy in a white kit dribbles the ball past a black-and-blue opponent on a grass pitch in clear autumn light; soft sky and blurred background across the top.",
    "tags": [
      "portrait",
      "action",
      "matchday",
      "kids",
      "boys",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u13-boy-dribbling-toward-camera.jpg",
    "w": 1080,
    "h": 1350,
    "caption": "A boy in a white kit runs towards the camera with the ball at his feet on a sunny grass pitch; blurred hillside across the top.",
    "tags": [
      "portrait",
      "action",
      "matchday",
      "kids",
      "boys",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u13-players-high-five-touchline.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Boys in white kits high-five beside the touchline on a sunny pitch with trees and a distant goal behind; open grass across the bottom.",
    "tags": [
      "landscape",
      "celebration",
      "matchday",
      "team",
      "kids",
      "boys",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-boy-dribbling-open-grass-sky.jpg",
    "w": 1200,
    "h": 1800,
    "caption": "A young boy in a white sponsored kit dribbles a ball across open grass on a sunny day; clear sky across the top third.",
    "tags": [
      "portrait",
      "action",
      "kids",
      "youth",
      "boys",
      "football",
      "matchday",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-u9-tournament-win-trophy-cheer.jpg",
    "w": 1600,
    "h": 900,
    "caption": "Young players in blue and white kits cheer with a trophy and medals beside adult staff outside a clubroom; plain pale wall and roofline across the top.",
    "tags": [
      "landscape",
      "team",
      "celebration",
      "tournament",
      "kids",
      "youth",
      "coach",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-two-boys-contest-ball-turf.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Two young players in blue and yellow kits contest a ball on an artificial pitch in bright daylight; plain turf across the bottom.",
    "tags": [
      "landscape",
      "action",
      "kids",
      "youth",
      "boys",
      "football",
      "training",
      "space-bottom"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-blue-kit-slide-tackle-tournament.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A blue-kit player slides to reach the ball between two red-kit opponents during a tournament match; a calm grass bank and tree line across the top.",
    "tags": [
      "landscape",
      "action",
      "kids",
      "football",
      "tournament",
      "matchday",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-blue-kit-dribbling-evening-match.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A blue-kit player dribbles the ball past a chasing red-kit player in soft evening light, with tents blurred behind; clear grass across the bottom.",
    "tags": [
      "landscape",
      "action",
      "kids",
      "boys",
      "football",
      "tournament",
      "matchday",
      "space-bottom"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-blue-kit-dribbling-past-defender.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A blue-kit player dribbles past a red-kit defender on a sunny turf pitch with players and fencing behind; open sky and tree line across the top.",
    "tags": [
      "landscape",
      "action",
      "kids",
      "football",
      "tournament",
      "matchday",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-boys-contest-ball-damp-pitch.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "Two boys contest the ball on a damp pitch in front of a sponsor board; clear grass across the bottom.",
    "tags": [
      "landscape",
      "action",
      "kids",
      "boys",
      "youth",
      "matchday",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-boy-strikes-ball-wet-pitch-spray.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A boy in a navy kit strikes the ball on a wet pitch and sends up a spray while a player in a bib runs in from the left; soft blurred background across the top.",
    "tags": [
      "landscape",
      "action",
      "kids",
      "boys",
      "youth",
      "training",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cufc",
    "src": "https://app.usg.co.nz/mailer/cufc/lib/nas-two-young-boys-chase-ball.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "Two young boys chase a ball across the pitch in front of sponsor banners, one in a bib and one in blue; soft green grass along the lower edge.",
    "tags": [
      "landscape",
      "action",
      "kids",
      "boys",
      "youth",
      "training",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-gold-kit-player-towel-floodlights.jpg",
    "w": 1440,
    "h": 1800,
    "caption": "A player in a gold kit holds a towel and claps under bright floodlights against a dark background; open dark space across the top.",
    "tags": [
      "portrait",
      "close-up",
      "adults",
      "matchday",
      "night",
      "candid",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-smiling-player-white-blue-kit.jpg",
    "w": 1440,
    "h": 1800,
    "caption": "A smiling young player in a white and blue kit walks beside a teammate in bright sun in front of a chain-link fence; soft pale sky and fence across the top.",
    "tags": [
      "portrait",
      "close-up",
      "adults",
      "candid",
      "matchday",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-player-dribbles-white-blue-kit.jpg",
    "w": 1440,
    "h": 1800,
    "caption": "A player in a white and blue kit dribbles the ball on green turf with spectators blurred behind the fence; open grass across the bottom.",
    "tags": [
      "portrait",
      "action",
      "adults",
      "matchday",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-siu-player-dribbling-green-pitch.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A player in a black and gold kit dribbles the ball across a green pitch with an opponent in yellow entering at the right edge; open turf across the bottom third.",
    "tags": [
      "landscape",
      "action",
      "matchday",
      "football",
      "adults",
      "space-bottom"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-siu-player-portrait-hillside-city.jpg",
    "w": 1800,
    "h": 1440,
    "caption": "A smiling young man in a white tee stands with arms folded on a grassy hillside with a hazy city behind him; soft overcast sky behind and above his head.",
    "tags": [
      "landscape",
      "portrait",
      "candid",
      "adults",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-siu-player-dribbling-warm-light.jpg",
    "w": 1800,
    "h": 1011,
    "caption": "A player in a black and gold kit dribbles across a green pitch in warm light with a red-kitted opponent following; open grass across the lower half.",
    "tags": [
      "landscape",
      "wide",
      "action",
      "matchday",
      "football",
      "adults",
      "space-bottom"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-siu-player-studio-portrait-grey.jpg",
    "w": 1200,
    "h": 1800,
    "caption": "A smiling player in a black and gold kit stands with arms folded against a plain grey studio backdrop; open backdrop to the left and right.",
    "tags": [
      "portrait",
      "adults",
      "football",
      "space-left",
      "space-right"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-siu-player-striking-ball-matchday.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A player in a black and gold kit lifts his leg to strike the ball as an opponent in light blue closes in; dark blurred background across the top.",
    "tags": [
      "landscape",
      "action",
      "matchday",
      "football",
      "adults",
      "space-top"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-siu-player-dribbling-empty-stadium.jpg",
    "w": 1800,
    "h": 1440,
    "caption": "A player in a black kit dribbles the ball across a green pitch in a near-empty stadium; dark stands at the left and clear grass along the bottom.",
    "tags": [
      "landscape",
      "action",
      "matchday",
      "football",
      "adults",
      "space-left",
      "space-bottom"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-man-arms-crossed-sunny-beach.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A young man in a black T-shirt stands with arms crossed on a sunny beach with sea and city behind him; open sky across the top third.",
    "tags": [
      "landscape",
      "candid",
      "adults",
      "space-top"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-player-green-bib-training-run.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A player in a green training bib runs toward a ball on a sunny grass pitch with teammates blurred behind; soft trees and open grass across the top.",
    "tags": [
      "landscape",
      "action",
      "training",
      "adults",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-players-contest-high-ball-training.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "Players leap to contest a high ball on a sunny training pitch with a goal and trees behind; open grass across the bottom.",
    "tags": [
      "landscape",
      "action",
      "training",
      "adults",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-player-black-gold-shirt-white-backdrop.jpg",
    "w": 1350,
    "h": 1800,
    "caption": "A young man in a black and gold South Island United shirt stands in three-quarter view against a white backdrop; clear white space to the left and right.",
    "tags": [
      "portrait",
      "adults",
      "football",
      "space-left",
      "space-right"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-player-arms-folded-white-backdrop.jpg",
    "w": 1350,
    "h": 1800,
    "caption": "A young man in a black and gold South Island United shirt stands with arms folded against a white backdrop; clear white space across the top and sides.",
    "tags": [
      "portrait",
      "adults",
      "football",
      "space-top",
      "space-left",
      "space-right"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-number-20-from-behind-matchday.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A player in a black and gold number 20 shirt, seen from behind, follows play on a sunlit grass pitch as a yellow-kit opponent looks on; soft blurred grass across the top.",
    "tags": [
      "landscape",
      "action",
      "matchday",
      "youth",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-black-gold-player-striking-ball.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A player in a black and gold kit strikes the ball on a sunlit grass pitch while a yellow-kit opponent closes in and spectators watch behind; open grass across the bottom.",
    "tags": [
      "landscape",
      "action",
      "matchday",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-man-white-tee-profile-green-hills.jpg",
    "w": 1350,
    "h": 1800,
    "caption": "A young man in a white T-shirt looks away in profile in front of green hills under a soft grey-blue sky; open sky across the top and left.",
    "tags": [
      "portrait",
      "adults",
      "candid",
      "space-top",
      "space-left"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-black-red-player-dribbles-past-blue.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A player in a black and red kit runs with the ball past a blue-kit opponent on a grass pitch in front of dark trees; dark tree line across the top.",
    "tags": [
      "landscape",
      "action",
      "matchday",
      "adults",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-siu-player-dribbling-green-pitch-2.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A player in a black and blue kit dribbles a ball across a green pitch while a few spectators watch beside a grey shed; plain shed wall across the top left.",
    "tags": [
      "landscape",
      "action",
      "matchday",
      "adults",
      "space-top"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-siu-player-kit-bag-night-smile.jpg",
    "w": 1440,
    "h": 1800,
    "caption": "A smiling player in a black and yellow tracksuit carries a kit bag across a car park under floodlights; dark night sky across the top third.",
    "tags": [
      "portrait",
      "candid",
      "night",
      "adults",
      "space-top"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-siu-player-dribbling-evening-stadium.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A player in a white and gold kit dribbles on a bright turf pitch in an evening stadium with a few blurred figures in the stand; pitchside board and turf on the right leave room for text.",
    "tags": [
      "landscape",
      "action",
      "matchday",
      "night",
      "adults",
      "space-right"
    ]
  },
  {
    "brand": "siu",
    "src": "https://app.usg.co.nz/mailer/siu/lib/nas-siu-night-match-ball-contest.jpg",
    "w": 1200,
    "h": 1800,
    "caption": "Under floodlights at night, a red-kitted player and a blue and white opponent contest the ball on the pitch, with an empty stand behind; dark sky across the top third.",
    "tags": [
      "portrait",
      "action",
      "matchday",
      "night",
      "adults",
      "space-top"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-four-players-contest-ball-pine-trees.jpg",
    "w": 1080,
    "h": 1350,
    "caption": "Four young players in blue, red and green kits contest the ball on a sunny turf pitch with pine trees behind; calm tree-line across the top third.",
    "tags": [
      "portrait",
      "action",
      "tournament",
      "kids",
      "youth",
      "boys",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-blue-boy-controls-ball-under-pressure.jpg",
    "w": 1080,
    "h": 1350,
    "caption": "A boy in blue controls the ball as a red-shirted opponent closes in on bright turf, with a blurred crowd behind; open turf across the bottom right.",
    "tags": [
      "portrait",
      "action",
      "tournament",
      "kids",
      "youth",
      "boys",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-striped-kit-boys-raise-trophy.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Boys in blue-and-white striped kits raise a trophy under the tournament banner on an indoor pitch; plain turf strip along the bottom.",
    "tags": [
      "landscape",
      "team",
      "celebration",
      "tournament",
      "youth",
      "kids",
      "boys",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-u15-final-players-contest-ball.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Two teenage players, one in yellow and one in navy, contest the ball on green turf with a sponsor banner and blurred spectators behind; open grass across the lower left.",
    "tags": [
      "landscape",
      "action",
      "tournament",
      "matchday",
      "teen",
      "youth",
      "football",
      "space-bottom",
      "space-left"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-green-white-team-trophy-night.jpg",
    "w": 1200,
    "h": 933,
    "caption": "A youth team in green and white striped shirts raises a trophy behind a Champions 2021 sign under floodlights, with coaches either side; dark night sky across the top.",
    "tags": [
      "landscape",
      "team",
      "celebration",
      "tournament",
      "night",
      "youth",
      "kids",
      "coach",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-gold-trophy-on-pitch-blue-sky.jpg",
    "w": 1800,
    "h": 1350,
    "caption": "A gold tournament trophy with a '10' engraving stands on a grass pitch with blurred trees behind; clear blue sky across the top third.",
    "tags": [
      "landscape",
      "tournament",
      "space-top"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-kids-contest-ball-red-black-kits.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Young players in red and navy and in black kits contest the ball on a turf pitch in daylight; calm wall and grass band across the top.",
    "tags": [
      "landscape",
      "action",
      "tournament",
      "matchday",
      "kids",
      "youth",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-yellow-team-huddle-celebration.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Yellow-kitted players form a celebratory huddle on the pitch with spectators behind a blue railing; clear turf across the bottom.",
    "tags": [
      "landscape",
      "team",
      "celebration",
      "tournament",
      "youth",
      "teen",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-light-blue-team-goal-celebration.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Light-blue teammates and a goalkeeper in purple gather and celebrate together on a turf pitch; pitch space across the bottom.",
    "tags": [
      "landscape",
      "team",
      "celebration",
      "tournament",
      "youth",
      "teen",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-u13-prizegiving-team-under-arch.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A team of young players in black kits and medals stands together under the Christchurch International Cup 10th anniversary arch at dusk; grass across the bottom.",
    "tags": [
      "landscape",
      "team",
      "tournament",
      "event",
      "youth",
      "kids",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-cic-summer-7s-champions-group.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A group of teenage boys in black kits with medals stands behind a cheque under a green tournament arch on a blue pitch; only a little quiet space, along the blue turf at the bottom edge.",
    "tags": [
      "landscape",
      "team",
      "celebration",
      "tournament",
      "youth",
      "teen",
      "boys",
      "football"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-summer-7s-header-contest-turf.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A player in white heads a ball while a red-shirted opponent and a goalkeeper in black watch on green turf, with teammates and a sponsor board behind; dark fence and trees clear across the top.",
    "tags": [
      "landscape",
      "action",
      "tournament",
      "youth",
      "teen",
      "boys",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-u15-final-yellow-player-celebrates.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A teenager in a yellow kit slides forward with fists raised in celebration on a turf pitch at dusk, with spectators behind a blue rail; open turf across the bottom third.",
    "tags": [
      "landscape",
      "celebration",
      "tournament",
      "matchday",
      "youth",
      "teen",
      "boys",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-u15-final-midfield-contest-yellow-navy.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Players in yellow and navy converge on the ball on a turf pitch under overcast light, with a referee in pink behind; limited room, some plain grass along the bottom right.",
    "tags": [
      "landscape",
      "action",
      "tournament",
      "matchday",
      "youth",
      "teen",
      "boys",
      "football"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-u15-final-team-huddle-navy.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A navy-kitted team with a goalkeeper in black stands in an arm-linked huddle on the pitch, seen from behind, with spectators blurred behind blue railings; open grass across the bottom.",
    "tags": [
      "landscape",
      "team",
      "tournament",
      "matchday",
      "warmup",
      "youth",
      "teen",
      "boys",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-u15-final-race-for-ball.jpg",
    "w": 1440,
    "h": 1800,
    "caption": "A yellow-kitted player and a navy-kitted player race for the ball on turf, with blurred spectators behind a blue fence; plain grass at the lower left.",
    "tags": [
      "portrait",
      "action",
      "tournament",
      "matchday",
      "youth",
      "teen",
      "boys",
      "football",
      "space-left"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-u10-dribble-past-defender-daylight.jpg",
    "w": 1800,
    "h": 1400,
    "caption": "A young boy in a maroon and yellow shirt dribbles a ball past a light blue defender on green turf in bright daylight; open turf and blue line along the bottom.",
    "tags": [
      "landscape",
      "action",
      "tournament",
      "matchday",
      "kids",
      "youth",
      "boys",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-boy-red-kit-striking-ball.jpg",
    "w": 1800,
    "h": 1400,
    "caption": "A boy in a red kit strikes a ball on a green turf pitch in bright daylight, with other players and a sponsor banner behind; clear turf across the bottom.",
    "tags": [
      "landscape",
      "action",
      "kids",
      "boys",
      "football",
      "tournament",
      "matchday",
      "space-bottom"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-navy-kit-dribbling-past-opponent.jpg",
    "w": 1800,
    "h": 1350,
    "caption": "A boy in a navy kit dribbles past a yellow-kit opponent on bright turf, with tents and trees behind; open grass across the bottom.",
    "tags": [
      "landscape",
      "action",
      "kids",
      "boys",
      "football",
      "tournament",
      "matchday",
      "space-bottom"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-yellow-and-red-kits-chasing-ball.jpg",
    "w": 1800,
    "h": 1350,
    "caption": "A boy in a yellow kit chases a ball past a red-kit opponent on bright artificial turf in low winter sun; clear turf across the bottom.",
    "tags": [
      "landscape",
      "action",
      "kids",
      "boys",
      "football",
      "tournament",
      "matchday",
      "space-bottom"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-blue-red-youth-match-sunny-wide.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "Players in blue and red kits chase the ball in a wide, sunny youth match with spectators and trees beyond the fence; clear grass along the bottom.",
    "tags": [
      "landscape",
      "wide",
      "action",
      "youth",
      "kids",
      "boys",
      "tournament",
      "matchday",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-teen-dribbles-ball-bright-pitch.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A teen in a blue kit dribbles the ball on a bright artificial pitch with a blurred group behind; dark tree line across the top.",
    "tags": [
      "landscape",
      "action",
      "teen",
      "youth",
      "boys",
      "tournament",
      "matchday",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-teen-leads-ball-green-turf-wide.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A teen in a blue kit pushes the ball forward on a green turf pitch as teammates and a few spectators stand behind in overcast light; clear grass across the lower third.",
    "tags": [
      "landscape",
      "wide",
      "action",
      "teen",
      "youth",
      "boys",
      "tournament",
      "matchday",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "cic",
    "src": "https://app.usg.co.nz/mailer/cic/lib/nas-player-dribbles-past-packed-stand.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A player in blue dribbles past a stand full of spectators with a tournament banner along the pitch edge; clear grass across the bottom.",
    "tags": [
      "landscape",
      "action",
      "teen",
      "youth",
      "boys",
      "crowd",
      "tournament",
      "matchday",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-orange-bibs-chase-ball-evening-turf.jpg",
    "w": 1616,
    "h": 1080,
    "caption": "Three adults in orange bibs chase a ball across a turf pitch in warm evening light with a goal behind; open grass along the bottom.",
    "tags": [
      "landscape",
      "action",
      "adults",
      "football",
      "matchday",
      "space-bottom"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-orange-bib-player-dribbles-turf.jpg",
    "w": 1440,
    "h": 1800,
    "caption": "A player in an orange bib and yellow boots dribbles a ball on a turf pitch with a goal and blurred goalkeeper behind; a little open grass along the bottom left.",
    "tags": [
      "portrait",
      "action",
      "adults",
      "football",
      "candid",
      "space-bottom"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-players-run-past-ball-dusk-turf.jpg",
    "w": 1440,
    "h": 1800,
    "caption": "Two players run side by side past a ball on a turf pitch at dusk while a third stands at the left; dark foliage across the top.",
    "tags": [
      "portrait",
      "action",
      "adults",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-smiling-man-strikes-ball-indoor-turf.jpg",
    "w": 1800,
    "h": 1200,
    "caption": "A smiling man in a grey tee strikes a ball on indoor turf under bright lights with teammates blurred behind; soft blue wall across the top.",
    "tags": [
      "landscape",
      "action",
      "adults",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-blue-kit-dribbler-faces-orange-bib.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A young player in a blue kit dribbles the ball towards an adult in an orange bib in front of a goal on a turf pitch; open turf along the bottom.",
    "tags": [
      "landscape",
      "action",
      "teen",
      "adults",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-champions-group-trophy-goal-night.jpg",
    "w": 1800,
    "h": 1350,
    "caption": "A group of adults in black tops celebrate in front of a goal at night, one holding up a gold trophy behind a Champions banner; dark sky across the top.",
    "tags": [
      "landscape",
      "team",
      "celebration",
      "adults",
      "football",
      "night",
      "space-top"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-blue-yellow-team-lifts-trophy-night.jpg",
    "w": 1800,
    "h": 1350,
    "caption": "A group in light blue and yellow shirts lifts a gold trophy beside a Champions banner in front of a goal on a floodlit pitch; dark sky across the top third.",
    "tags": [
      "landscape",
      "wide",
      "team",
      "celebration",
      "adults",
      "women",
      "football",
      "night",
      "space-top"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-adult-kicking-ball-warmup-turf.jpg",
    "w": 1440,
    "h": 1800,
    "caption": "An adult in a dark puffer jacket and blue gloves swings a leg to kick a ball on a floodlit turf pitch while players stand soft in the background; quiet turf across the bottom third.",
    "tags": [
      "portrait",
      "action",
      "warmup",
      "adults",
      "candid",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-orange-bib-striking-ball-dusk.jpg",
    "w": 1616,
    "h": 1080,
    "caption": "A player in an orange bib strikes a ball on the turf in golden dusk light, with a small-sided football sponsor banner and trees behind; open turf across the bottom.",
    "tags": [
      "landscape",
      "action",
      "adults",
      "candid",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-green-shirt-dribbling-past-bench.jpg",
    "w": 1616,
    "h": 1080,
    "caption": "A player in a green shirt dribbles a ball across the turf past an empty bench, with a goal at the right in soft evening light; dark hedge and open grass across the top and bottom.",
    "tags": [
      "landscape",
      "action",
      "adults",
      "candid",
      "football",
      "space-top",
      "space-bottom"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-player-from-behind-dribbling-evening.jpg",
    "w": 1440,
    "h": 1800,
    "caption": "A player seen from behind in a navy top dribbles a ball on turf in warm evening light, with dark trees and a sponsor banner behind; dark foliage across the top.",
    "tags": [
      "portrait",
      "action",
      "adults",
      "candid",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-two-players-ball-control-evening.jpg",
    "w": 1440,
    "h": 1800,
    "caption": "A player in an orange bib controls a ball beside a teammate in navy on turf in soft evening light, with a blurred figure behind; dark foliage across the top.",
    "tags": [
      "portrait",
      "action",
      "training",
      "adults",
      "candid",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-green-shirt-player-dribbling-forward.jpg",
    "w": 1440,
    "h": 1800,
    "caption": "A player in a green shirt dribbles a ball toward the camera on turf with a bench and grass bank behind; soft green space across the top.",
    "tags": [
      "portrait",
      "action",
      "adults",
      "candid",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-indoor-turf-blue-bib-dribble.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A player in a light blue bib dribbles an orange ball across indoor turf under bright lights, with a goal and bench behind; open turf across the lower frame.",
    "tags": [
      "landscape",
      "action",
      "adults",
      "night",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-two-men-challenge-ball-goalmouth.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "Two men challenge for a ball on turf in front of a goal while a keeper watches, with a grass bank behind; soft green space across the top.",
    "tags": [
      "landscape",
      "action",
      "adults",
      "candid",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-teen-dribbling-turf-small-sided.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A young player in a yellow and blue shirt dribbles a ball on turf as a player in red runs in beside him and others stand by a goal behind; open turf to the right of the frame.",
    "tags": [
      "landscape",
      "action",
      "adults",
      "teen",
      "football",
      "night",
      "space-right"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-two-players-tussle-beside-goal.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "Two players, one in an orange bib and one in blue, tussle for the ball beside a goal on turf in soft light; dark hedge across the top.",
    "tags": [
      "landscape",
      "action",
      "adults",
      "football",
      "matchday",
      "candid",
      "space-top"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-players-contest-ball-on-turf.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "Two players in blue and black contest the ball on turf while teammates look on behind a white boundary line; plain grass bank across the top.",
    "tags": [
      "landscape",
      "action",
      "adults",
      "football",
      "matchday",
      "space-top"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-man-dribbling-past-dugout.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A man in a white shirt dribbles a ball on green turf with a player in black close behind, beside a grey dugout; clear turf across the bottom.",
    "tags": [
      "landscape",
      "action",
      "adults",
      "football",
      "matchday",
      "space-bottom"
    ]
  },
  {
    "brand": "mfl",
    "src": "https://app.usg.co.nz/mailer/mfl/lib/nas-player-lines-up-ball-teammates.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A player in a blue and yellow kit lines up a ball on turf while three teammates stand watching behind him; open turf across the bottom.",
    "tags": [
      "landscape",
      "team",
      "teen",
      "football",
      "matchday",
      "candid",
      "space-bottom"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-gymnast-backbend-on-floor-mat.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A young gymnast in a colourful leotard folds into a head-down backbend on a floor mat while seated spectators watch behind; open floor across the bottom.",
    "tags": [
      "landscape",
      "action",
      "kids",
      "girls",
      "gymnastics",
      "space-bottom"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-girls-linked-arms-gym-warmup.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "Four girls in navy and red gymnastics tops link arms in a line during a warm-up in a bright hall; plain hall wall across the top.",
    "tags": [
      "landscape",
      "warmup",
      "team",
      "kids",
      "girls",
      "gymnastics",
      "space-top"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-gymnasts-team-photo-bright-hall.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "About ten young gymnasts in colourful patterned leotards stand together for a team photo in a bright gym hall; open floor across the bottom.",
    "tags": [
      "landscape",
      "team",
      "kids",
      "youth",
      "girls",
      "gymnastics",
      "space-bottom"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-gymnasts-hoops-wide-floor.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "Two young gymnasts with hoops perform on a wide floor, one balancing on one hand with a leg extended high; open floor across the bottom.",
    "tags": [
      "wide",
      "landscape",
      "action",
      "kids",
      "girls",
      "gymnastics",
      "training",
      "space-bottom"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-gymnast-leap-open-floor.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A gymnast in a colourful leotard leaps across a cream floor with arms outstretched, with spectators seated along the far wall; open floor across the lower left.",
    "tags": [
      "landscape",
      "wide",
      "action",
      "gymnastics",
      "kids",
      "youth",
      "girls",
      "venue",
      "space-bottom"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-handstand-split-bright-hall.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A gymnast in a navy uniform holds a handstand with legs split wide on a cream mat in a bright hall; clear floor across the bottom.",
    "tags": [
      "landscape",
      "action",
      "gymnastics",
      "youth",
      "girls",
      "training",
      "venue",
      "space-bottom"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-hoop-practice-wide-mat.jpg",
    "w": 1202,
    "h": 1800,
    "caption": "A gymnast in a patterned leotard swings a hoop overhead while others practise behind her on a wide mat; open floor across the bottom third.",
    "tags": [
      "portrait",
      "action",
      "gymnastics",
      "youth",
      "girls",
      "training",
      "venue",
      "space-bottom"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-seated-hoop-pose-floor.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A gymnast in an orange leotard sits on the mat with a hoop held up beside her while another gymnast stretches at left and spectators watch from behind; clean floor across the bottom.",
    "tags": [
      "landscape",
      "wide",
      "gymnastics",
      "kids",
      "girls",
      "training",
      "venue",
      "space-bottom"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-hoops-group-bright-hall.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "Young gymnasts in orange and blue leotards swing hoops across a large bright hall, with one girl sharp in the foreground; open floor across the bottom.",
    "tags": [
      "landscape",
      "wide",
      "action",
      "gymnastics",
      "kids",
      "youth",
      "girls",
      "training",
      "venue",
      "space-bottom"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-split-stretch-partner-mat.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "One gymnast stretches into a high standing split over a partner lying on the mat in a bright hall; open floor across the lower half.",
    "tags": [
      "landscape",
      "wide",
      "gymnastics",
      "youth",
      "girls",
      "training",
      "venue",
      "space-bottom"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-balance-stretch-united-banners.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A gymnast in a dark top and black leggings holds a leg raised in a balance in front of United banners in a bright hall; open floor at the bottom right.",
    "tags": [
      "landscape",
      "wide",
      "gymnastics",
      "youth",
      "girls",
      "training",
      "venue",
      "space-bottom",
      "space-right"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-rhythmic-balance-large-hall.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A rhythmic gymnast in a blue leotard holds a balance on a pale floor in a large hall, with spectators seated along the far side; open floor across the bottom.",
    "tags": [
      "landscape",
      "wide",
      "action",
      "gymnastics",
      "youth",
      "girls",
      "venue",
      "space-bottom"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-gymnast-toe-balance-hall.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A gymnast in a black and gold leotard balances on her toes with one arm raised in a large hall, with spectators seated behind; open floor across the bottom.",
    "tags": [
      "landscape",
      "wide",
      "action",
      "gymnastics",
      "youth",
      "girls",
      "venue",
      "space-bottom"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-girls-barre-stretch-timber-studio.jpg",
    "w": 1202,
    "h": 1800,
    "caption": "A line of girls in black training clothes stretch their arms along a barre in a timber-floored studio; open floor space across the bottom.",
    "tags": [
      "portrait",
      "gymnastics",
      "training",
      "kids",
      "girls",
      "youth",
      "space-bottom"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-long-barre-row-wood-studio.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "A long row of girls in black training clothes stretch with raised arms along a barre in a wood-floored studio; open floor across the bottom third.",
    "tags": [
      "landscape",
      "wide",
      "gymnastics",
      "training",
      "kids",
      "girls",
      "youth",
      "team",
      "space-bottom"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-gymnasts-barre-bright-window-studio.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "Young gymnasts in dark training clothes line up along a wooden barre in a bright studio with tall pale windows; clear space down the left side.",
    "tags": [
      "landscape",
      "wide",
      "gymnastics",
      "training",
      "kids",
      "girls",
      "youth",
      "space-left"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-gymnasts-barre-portrait-timber-beams.jpg",
    "w": 1202,
    "h": 1800,
    "caption": "A line of gymnasts holds a wooden barre in a bright studio with timber beams overhead; clear white wall space on the left.",
    "tags": [
      "portrait",
      "gymnastics",
      "training",
      "kids",
      "girls",
      "youth",
      "space-left"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-three-gymnasts-kneeling-arms-raised.jpg",
    "w": 1800,
    "h": 1202,
    "caption": "Three young gymnasts in navy tops kneel on a cream floor with one arm raised in a group routine; clear floor space across the bottom.",
    "tags": [
      "landscape",
      "gymnastics",
      "training",
      "kids",
      "girls",
      "youth",
      "team",
      "space-bottom"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-coach-portrait-navy-club-jacket.jpg",
    "w": 1350,
    "h": 1800,
    "caption": "A smiling woman in a navy and red club jacket stands against a plain white background in a clean portrait; empty wall above and to both sides.",
    "tags": [
      "portrait",
      "coach",
      "women",
      "adults",
      "gymnastics",
      "space-top",
      "space-left",
      "space-right"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-coach-portrait-white-wall-jacket.jpg",
    "w": 1350,
    "h": 1800,
    "caption": "A smiling young woman in a navy club jacket with red and white trim stands against a plain white wall in a studio-style portrait; open space above.",
    "tags": [
      "portrait",
      "coach",
      "women",
      "adults",
      "gymnastics",
      "space-top"
    ]
  },
  {
    "brand": "cugc",
    "src": "https://app.usg.co.nz/mailer/cugc/lib/nas-woman-track-jacket-grey-headshot.jpg",
    "w": 1202,
    "h": 1800,
    "caption": "A smiling woman in a navy and red-white track jacket stands against a plain grey backdrop in a studio headshot; clear grey space across the top.",
    "tags": [
      "portrait",
      "adults",
      "women",
      "space-top"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/nas-empty-turf-pitch-blue-sky.jpg",
    "w": 1800,
    "h": 1350,
    "caption": "An empty synthetic turf pitch with white markings, floodlight masts and a small goal under a bright blue sky with wispy clouds; clear sky across the top third.",
    "tags": [
      "landscape",
      "wide",
      "venue",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/nas-aerial-turf-pitch-blue-surrounds.jpg",
    "w": 900,
    "h": 598,
    "caption": "Aerial view of a green turf pitch with blue surrounds, goals and floodlights, set among paddocks and trees; open grass across the bottom left.",
    "tags": [
      "landscape",
      "wide",
      "venue",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/nas-drone-pitch-grandstand-clear-sky.jpg",
    "w": 1800,
    "h": 1350,
    "caption": "Aerial view of a floodlit pitch with blue track, grandstand and flags, with a few small players warming up at lower left; clear blue sky across the top.",
    "tags": [
      "landscape",
      "wide",
      "venue",
      "warmup",
      "football",
      "space-top"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/nas-elevated-striped-pitch-grandstand.jpg",
    "w": 1800,
    "h": 1350,
    "caption": "Elevated view of a striped turf pitch with grandstand and a small group of players beside the centre circle; open grass across the bottom.",
    "tags": [
      "landscape",
      "wide",
      "venue",
      "football",
      "space-bottom"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/nas-hanging-training-ball-turf-line.jpg",
    "w": 1800,
    "h": 1350,
    "caption": "A black-and-white training ball hangs on a string above green turf beside a white line, with a blue wall blurred behind; quiet blue wall at the upper left.",
    "tags": [
      "landscape",
      "close-up",
      "training",
      "football",
      "venue",
      "space-top",
      "space-left"
    ]
  },
  {
    "brand": "usc",
    "src": "https://app.usg.co.nz/mailer/usc/lib/nas-football-on-turf-close-up.jpg",
    "w": 1800,
    "h": 1350,
    "caption": "A black-and-white football sits on green turf with a string trailing to the right, background softly blurred; soft blurred band across the top.",
    "tags": [
      "landscape",
      "close-up",
      "training",
      "football",
      "venue",
      "space-top"
    ]
  }
];
