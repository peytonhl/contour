"""One-time seeder: fetch discographies for the top artists and persist to DB.

Run once on Railway via:
    railway run python scripts/seed_top_artists.py

Or triggered automatically 90s after each deploy (see main.py).
After the first run, subsequent deploys skip all fresh artists and exit
in seconds — zero Spotify calls.

How it works:
  1. For each artist name, searches Spotify to resolve the artist ID.
  2. Fetches their full discography (/artists/{id}/albums).
  3. Persists albums to AlbumCache and stamps ArtistCache with a timestamp.

Safety:
  - Skips artists fetched within the last 7 days (idempotent / safe to re-run).
  - 1.5s delay between Spotify calls (~40/min, well under rate limits).
  - Backs off on 429, then continues. Never crashes.

Estimated runtime: ~50 min for 1,000 artists (two calls each: search + discography).
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timedelta

from sqlalchemy import select

from database import AsyncSessionLocal
from models import AlbumCache as AlbumCacheModel, ArtistCache
from services import spotify as spotify_svc

# ── Artist list (~1,000) ──────────────────────────────────────────────────────
# Organized by genre. Names matched against Spotify's artist search.
# Exact spelling matters — Spotify is forgiving but not perfect.

ARTIST_NAMES = [
    # ── Hip-Hop / Rap — Current ───────────────────────────────────────────────
    "Drake", "Kendrick Lamar", "J. Cole", "Travis Scott", "Future",
    "Lil Baby", "21 Savage", "Don Toliver", "Playboi Carti", "Gunna",
    "Kanye West", "Post Malone", "Lil Uzi Vert", "Juice WRLD", "Lil Durk",
    "Nicki Minaj", "Cardi B", "Lil Wayne", "Young Thug", "Meek Mill",
    "A$AP Rocky", "Big Sean", "2 Chainz", "Rick Ross", "Pusha T",
    "Mac Miller", "Childish Gambino", "Tyler, the Creator", "Earl Sweatshirt",
    "Logic", "NF", "Rod Wave", "Kevin Gates", "Polo G", "NBA YoungBoy",
    "Kodak Black", "DaBaby", "Roddy Ricch", "Lil Tjay", "Pop Smoke",
    "Jack Harlow", "Fivio Foreign", "Trippie Redd", "6LACK", "Lil Skies",
    "YNW Melly", "Moneybagg Yo", "EST Gee", "42 Dugg", "G Herbo",
    "Calboy", "Mozzy", "Chance the Rapper", "Big K.R.I.T.",
    "Isaiah Rashad", "ScHoolboy Q", "Ab-Soul", "Jay Rock", "Vince Staples",
    "Joey Bada$$", "JID", "Bas", "Earthgang", "Dreamville",
    "Wale", "Fabolous", "Jadakiss", "Lloyd Banks", "Dave East",
    "Jim Jones", "Joyner Lucas", "Token", "Ski Mask the Slump God",
    "Smokepurpp", "Lil Pump", "Lil Xan", "6ix9ine", "Blueface",
    "Comethazine", "Sheck Wes", "Lil Mosey", "YBN Nahmir", "Rich the Kid",
    "Gunna", "Lil Keed", "Lil Gotit", "Rylo Rodriguez", "Nardo Wick",
    "Yeat", "Ken Carson", "Destroy Lonely", "Summrs", "Lil Uzi Vert",
    "Lucki", "Injury Reserve", "JPEGMAFIA", "Danny Brown", "Mavi",
    "Mach-Hommy", "Billy Woods", "Armand Hammer", "Open Mike Eagle",
    "Injury Reserve", "clipping.", "Death Grips", "Show Me the Body",
    "Freddie Gibbs", "Madlib", "MF DOOM", "Czarface", "Grieves",
    "Atmosphere", "Brother Ali", "Aesop Rock", "Eyedea", "Slug",
    "Sage Francis", "Brother Ali", "P.O.S.", "Dessa", "Prof",
    "Watsky", "Watsky", "Andy Mineo", "Lecrae", "Trip Lee",
    "Yelawolf", "Machine Gun Kelly", "Mod Sun", "Futuristic",
    "Hopsin", "Jarren Benton", "Tech N9ne", "Strange Music",

    # ── Hip-Hop / Rap — Classic & Legacy ─────────────────────────────────────
    "Nas", "Jay-Z", "Notorious B.I.G.", "Tupac Shakur", "Snoop Dogg",
    "Dr. Dre", "Ice Cube", "DMX", "Ja Rule", "Eminem",
    "50 Cent", "Lloyd Banks", "Tony Yayo", "Young Buck", "The Game",
    "Ludacris", "T.I.", "Lil Jon", "Chingy", "Nelly",
    "Missy Elliott", "Eve", "Da Brat", "Lil Kim", "Foxy Brown",
    "Lauryn Hill", "Fugees", "Wyclef Jean", "Pras", "Refugee Camp",
    "OutKast", "André 3000", "Big Boi", "Goodie Mob", "CeeLo Green",
    "Dungeon Family", "Organized Noize", "Cee Lo Green",
    "Wu-Tang Clan", "RZA", "GZA", "Method Man", "Redman",
    "Raekwon", "Ghostface Killah", "Inspectah Deck", "U-God",
    "Masta Killa", "Ol' Dirty Bastard", "Cappadonna",
    "Busta Rhymes", "Q-Tip", "A Tribe Called Quest",
    "De La Soul", "Black Star", "Mos Def", "Talib Kweli",
    "Common", "Kanye West", "Lupe Fiasco", "Kid Cudi",
    "Big L", "Big Pun", "Fat Joe", "Remy Ma", "Terror Squad",
    "Cam'ron", "Jim Jones", "Dipset", "Juelz Santana",
    "Young Jeezy", "Gucci Mane", "T.I.", "Boosie Badazz",
    "Webbie", "Lil Boosie", "Kevin Gates", "Mystikal",
    "Master P", "No Limit Records", "Silkk the Shocker",
    "Juvenile", "Cash Money Records", "Mannie Fresh",
    "Chamillionaire", "Paul Wall", "Mike Jones", "Slim Thug",
    "Three 6 Mafia", "Project Pat", "Juicy J", "DJ Paul",
    "UGK", "Pimp C", "Bun B", "Z-Ro", "Trae tha Truth",
    "Scarface", "Geto Boys", "Willie D", "Bushwick Bill",
    "Ice-T", "Ice Cube", "Cypress Hill", "B-Real", "Sen Dog",
    "Public Enemy", "Chuck D", "Flava Flav", "EPMD",
    "Rakim", "Eric B.", "KRS-One", "Boogie Down Productions",
    "Run-DMC", "LL Cool J", "Beastie Boys", "Salt-N-Pepa",

    # ── R&B / Soul — Current ──────────────────────────────────────────────────
    "Frank Ocean", "SZA", "The Weeknd", "Usher", "Beyoncé",
    "Summer Walker", "Jhené Aiko", "H.E.R.", "Tinashe", "Kehlani",
    "Daniel Caesar", "Giveon", "Lucky Daye", "Ari Lennox", "Snoh Aalegra",
    "Ella Mai", "Brent Faiyaz", "Omar Apollo", "Pink Sweat$",
    "dvsn", "PARTYNEXTDOOR", "Joyce Wrice", "Amber Mark",
    "Solange", "Erykah Badu", "D'Angelo", "Maxwell",
    "Alicia Keys", "John Legend", "Mary J. Blige",
    "Mariah Carey", "Whitney Houston", "Aretha Franklin",
    "Stevie Wonder", "Al Green", "Luther Vandross",
    "Toni Braxton", "Brandy", "Monica", "Destiny's Child",
    "TLC", "En Vogue", "SWV", "Xscape", "702",
    "Boyz II Men", "New Edition", "New Kids on the Block",
    "Janet Jackson", "Jodeci", "Guy", "Teddy Riley",
    "Ne-Yo", "Chris Brown", "Trey Songz", "Tank",
    "Tyrese", "Ginuwine", "Omarion", "Mario",
    "Ciara", "Ashanti", "Keyshia Cole", "Fantasia",
    "Jennifer Hudson", "Jazmine Sullivan", "Ledisi", "Lalah Hathaway",
    "Jill Scott", "India.Arie", "Musiq Soulchild", "Anthony Hamilton",
    "Robin Thicke", "John Mayer", "James Bay", "Tom Grennan",
    "Lucky Daye", "Victoria Monét", "Chlöe", "Muni Long",
    "Latto", "Flo Milli", "Doechii", "GloRilla", "Glorilla",
    "Coco Jones", "Ari Lennox", "Mereba", "Raveena",
    "Sza", "Normani", "Sabrina Claudio", "Doja Cat",

    # ── Pop — Current ─────────────────────────────────────────────────────────
    "Taylor Swift", "Ariana Grande", "Billie Eilish", "Dua Lipa",
    "Olivia Rodrigo", "Justin Bieber", "Bruno Mars", "Ed Sheeran",
    "Harry Styles", "Selena Gomez", "Shawn Mendes",
    "Camila Cabello", "Halsey", "Lorde", "Charli XCX", "Troye Sivan",
    "Lizzo", "Demi Lovato", "Miley Cyrus", "Katy Perry", "Lady Gaga",
    "Rihanna", "Adele", "Sam Smith", "Sia", "P!nk",
    "Ava Max", "Tate McRae", "Gracie Abrams", "Sabrina Carpenter",
    "Conan Gray", "Clairo", "Beabadoobee", "Phoebe Bridgers",
    "Hozier", "Dermot Kennedy", "Lewis Capaldi", "James Arthur",
    "Anne-Marie", "Bebe Rexha", "Julia Michaels", "Hailee Steinfeld",
    "Meghan Trainor", "Zara Larsson", "Sigrid", "Astrid S",
    "Dagny", "Alma", "Tove Lo", "Robyn",
    "Carly Rae Jepsen", "Kacey Musgraves", "Maren Morris",
    "Maggie Rogers", "Brandi Carlile", "Yola", "Maisie Peters",
    "girl in red", "Cavetown", "Novo Amor", "Rex Orange County",
    "Declan McKenna", "BENEE", "Mxmtoon", "Remi Wolf",
    "Rina Sawayama", "Caroline Polachek", "Magdalena Bay",
    "Soccer Mommy", "Snail Mail", "Lucy Dacus", "Julien Baker",
    "boygenius", "Faye Webster", "Alexandra Savior", "Ethel Cain",
    "Weyes Blood", "Angel Olsen", "Sharon Van Etten",
    "Nick Jonas", "Jonas Brothers", "Niall Horan", "Zayn",
    "One Direction", "Little Mix", "Spice Girls", "Backstreet Boys",
    "*NSYNC", "Christina Aguilera", "Britney Spears", "Destiny's Child",
    "Kylie Minogue", "Dua Lipa", "Rita Ora", "Jessie J",
    "Ellie Goulding", "Zedd", "Clean Bandit", "Years & Years",

    # ── Rock / Alternative — Current ──────────────────────────────────────────
    "The 1975", "Glass Animals", "Jungle", "Phoenix", "Vampire Weekend",
    "MGMT", "Tame Impala", "Beach House", "Mac DeMarco", "Alex G",
    "Arctic Monkeys", "The Strokes", "Interpol", "Yeah Yeah Yeahs",
    "Bloc Party", "Franz Ferdinand", "The Killers", "Kings of Leon",
    "Florence + the Machine", "The National", "Bon Iver", "Sufjan Stevens",
    "LCD Soundsystem", "Hot Chip", "Caribou", "Four Tet",
    "Big Thief", "Mitski", "Japanese Breakfast", "Waxahatchee",
    "Palehound", "Hand Habits", "Tomberlin", "Squirrel Flower",
    "Adrianne Lenker", "Circuit des Yeux", "Haley Heynderickx",
    "Pinegrove", "Pedro the Lion", "Hop Along", "Saintseneca",
    "The War on Drugs", "Kurt Vile", "Cass McCombs",
    "Real Estate", "Woods", "Widowspeak", "Purling Hiss",
    "Ty Segall", "Osees", "White Reaper", "Surf Curse",
    "Narrow Head", "Spirit of the Beehive", "Wednesday", "Julien Baker",
    "illuminati hotties", "Militarie Gun", "Pom Pom Squad",
    "Turnstile", "Knocked Loose", "Code Orange", "Spiritbox",
    "Architects", "Bring Me the Horizon", "Parkway Drive",
    "Trivium", "Bullet for My Valentine", "Avenged Sevenfold",
    "Sleeping with Sirens", "Pierce the Veil", "Mayday Parade",
    "The Maine", "All Time Low", "New Found Glory", "Yellowcard",
    "The Story So Far", "Neck Deep", "Knuckle Puck",
    "Movements", "Real Friends", "Like Pacific",
    "Twenty One Pilots", "Paramore", "Hayley Williams",
    "5 Seconds of Summer", "Tonight Alive", "Stand Atlantic",
    "Pvris", "Against the Current", "Waterparks",
    "State Champs", "We the Kings", "Forever the Sickest Kids",
    "Cobra Starship", "Gym Class Heroes", "The Academy Is...",
    "Cute Is What We Aim For", "Breathe Carolina", "Set Your Goals",

    # ── Rock / Alternative — Classic ──────────────────────────────────────────
    "The Beatles", "Led Zeppelin", "Pink Floyd", "The Rolling Stones",
    "Nirvana", "Pearl Jam", "Soundgarden", "Alice in Chains",
    "Red Hot Chili Peppers", "Foo Fighters", "Green Day", "Blink-182",
    "Weezer", "The Smashing Pumpkins", "Radiohead", "Oasis",
    "Blur", "Pulp", "Suede", "Elastica", "Supergrass",
    "Blur", "The Verve", "Manic Street Preachers",
    "R.E.M.", "Pixies", "The Replacements", "Hüsker Dü",
    "Sonic Youth", "Dinosaur Jr.", "Pavement", "Built to Spill",
    "Guided by Voices", "Sebadoh", "Superchunk", "Archers of Loaf",
    "Neutral Milk Hotel", "Modest Mouse", "Death Cab for Cutie",
    "The Postal Service", "Bright Eyes", "Conor Oberst",
    "Saves the Day", "Dashboard Confessional", "Taking Back Sunday",
    "Thursday", "Hawthorne Heights", "The Used", "My Chemical Romance",
    "Fall Out Boy", "Panic! at the Disco", "Paramore",
    "Linkin Park", "Evanescence", "30 Seconds to Mars",
    "Disturbed", "Breaking Benjamin", "Three Days Grace",
    "Seether", "Hinder", "Shinedown", "Nickelback",
    "Creed", "Staind", "Puddle of Mudd", "Default",
    "Audioslave", "Rage Against the Machine", "Tool",
    "System of a Down", "Deftones", "Chevelle",
    "Queens of the Stone Age", "Nine Inch Nails", "Marilyn Manson",
    "Rob Zombie", "White Zombie", "Korn", "Limp Bizkit",
    "Slipknot", "Mudvayne", "Drowning Pool",
    "Metallica", "Megadeth", "Anthrax", "Slayer",
    "Black Sabbath", "Ozzy Osbourne", "Iron Maiden", "Judas Priest",
    "AC/DC", "Van Halen", "Guns N' Roses", "Mötley Crüe",
    "Bon Jovi", "Def Leppard", "Whitesnake", "Poison",
    "Aerosmith", "Kiss", "Alice Cooper", "Ted Nugent",

    # ── Classic Rock / Legacy ─────────────────────────────────────────────────
    "Queen", "David Bowie", "Elton John", "The Who", "The Doors",
    "Jimi Hendrix", "Janis Joplin", "Creedence Clearwater Revival",
    "Lynyrd Skynyrd", "ZZ Top", "Tom Petty", "Bruce Springsteen",
    "Bob Dylan", "Neil Young", "Joni Mitchell", "Carole King",
    "James Taylor", "Carly Simon", "Jackson Browne",
    "Fleetwood Mac", "Stevie Nicks", "Lindsey Buckingham",
    "Eagles", "Don Henley", "Glenn Frey", "Joe Walsh",
    "Crosby, Stills, Nash & Young", "Buffalo Springfield",
    "The Byrds", "The Mamas & the Papas", "Simon & Garfunkel",
    "Paul Simon", "Art Garfunkel", "Billy Joel", "Elton John",
    "Randy Newman", "Harry Nilsson", "Todd Rundgren",
    "Cheap Trick", "Tom Petty and the Heartbreakers",
    "John Mellencamp", "Bob Seger", "Jackson Browne",
    "Little Feat", "J.J. Cale", "Lowell George",
    "Grateful Dead", "Jefferson Airplane", "Santana",
    "Creedence Clearwater Revival", "The Band", "The Allman Brothers Band",
    "Derek and the Dominos", "Eric Clapton", "Cream",

    # ── Soul / Funk / Motown ──────────────────────────────────────────────────
    "Michael Jackson", "Prince", "James Brown", "Ray Charles",
    "Marvin Gaye", "Al Green", "Otis Redding", "Sam Cooke",
    "Aretha Franklin", "Stevie Wonder", "Gladys Knight",
    "Diana Ross", "The Supremes", "The Temptations",
    "Four Tops", "The Jackson 5", "Commodores", "Lionel Richie",
    "Earth, Wind & Fire", "Sly and the Family Stone",
    "Funkadelic", "Parliament", "George Clinton",
    "The Isley Brothers", "Curtis Mayfield", "Isaac Hayes",
    "Barry White", "Teddy Pendergrass", "Harold Melvin",
    "The O'Jays", "Spinners", "Chi-Lites", "Harold Melvin and the Blue Notes",
    "Tower of Power", "Kool & the Gang", "Ohio Players",
    "Cameo", "Zapp", "Roger Troutman", "Rick James",
    "Chaka Khan", "Rufus", "Teena Marie", "Maze",
    "Frankie Beverly", "Gap Band", "Con Funk Shun",

    # ── Jazz ──────────────────────────────────────────────────────────────────
    "Miles Davis", "John Coltrane", "Louis Armstrong", "Ella Fitzgerald",
    "Duke Ellington", "Count Basie", "Thelonious Monk",
    "Charlie Parker", "Dizzy Gillespie", "Billie Holiday",
    "Sarah Vaughan", "Nat King Cole", "Frank Sinatra", "Tony Bennett",
    "Dean Martin", "Sammy Davis Jr.", "Chet Baker",
    "Bill Evans", "Oscar Peterson", "Dave Brubeck",
    "Sonny Rollins", "Ornette Coleman", "Charles Mingus",
    "Herbie Hancock", "Chick Corea", "Keith Jarrett",
    "Pat Metheny", "Wynton Marsalis", "Branford Marsalis",
    "Diana Krall", "Norah Jones", "Gregory Porter",
    "Kamasi Washington", "Esperanza Spalding", "Robert Glasper",
    "Thundercat", "Flying Lotus", "Knower",

    # ── Electronic / Dance ────────────────────────────────────────────────────
    "Daft Punk", "Calvin Harris", "Marshmello", "The Chainsmokers",
    "Diplo", "Skrillex", "Deadmau5", "Avicii", "Zedd",
    "Martin Garrix", "David Guetta", "Tiësto", "Kygo",
    "Disclosure", "Flume", "Kaytranada", "James Blake",
    "Jamie xx", "Mount Kimbie", "Bonobo", "Tycho", "Moby",
    "Aphex Twin", "Burial", "Arca", "Kelela", "FKA twigs",
    "The xx", "James Blake", "How to Dress Well",
    "Jon Hopkins", "Max Richter", "Nils Frahm",
    "Thom Yorke", "Brian Eno", "Kraftwerk",
    "Chemical Brothers", "Prodigy", "Fatboy Slim",
    "Basement Jaxx", "Underworld", "Orbital",
    "Massive Attack", "Portishead", "Tricky",
    "Björk", "Sigur Rós", "múm",
    "Justice", "SebastiAn", "Kavinsky",
    "Gesaffelstein", "Brodinski", "Para One",
    "Madeon", "Porter Robinson", "Giraffage",
    "ODESZA", "Big Wild", "Lane 8",
    "Illenium", "Seven Lions", "Above & Beyond",
    "Deadmau5", "Eric Prydz", "Tale Of Us",
    "Amelie Lens", "Charlotte de Witte", "Solomun",
    "Fisher", "Chris Lake", "John Summit",
    "Fred again..", "Mall Grab", "Peggy Gou",
    "Honey Dijon", "DJ Koze", "Henrik Schwarz",

    # ── Indie / Alternative ───────────────────────────────────────────────────
    "Radiohead", "Arcade Fire", "LCD Soundsystem", "Animal Collective",
    "Grizzly Bear", "Fleet Foxes", "Bon Iver", "Sufjan Stevens",
    "The National", "Wilco", "Yo La Tengo", "Stereolab",
    "Pavement", "Built to Spill", "Guided by Voices",
    "Neutral Milk Hotel", "Modest Mouse", "Death Cab for Cutie",
    "Iron & Wine", "Bright Eyes", "Sun Kil Moon",
    "Nick Drake", "Elliott Smith", "Alex Turner",
    "Courtney Barnett", "Stella Donnelly", "Camp Cope",
    "Waxahatchee", "Hurray for the Riff Raff", "Julien Baker",
    "Lucy Dacus", "Phoebe Bridgers", "boygenius",
    "Big Thief", "Adrianne Lenker", "Buck Meek",
    "Feist", "Broken Social Scene", "Stars",
    "Wolf Parade", "Sunset Rubdown", "Handsome Furs",
    "Spoon", "Interpol", "Editors", "White Lies",
    "The Walkmen", "She & Him", "M. Ward",
    "Neko Case", "A.A. Bondy", "Jason Isbell",
    "Phosphorescent", "William Tyler", "Steve Gunn",
    "Ryley Walker", "Mdou Moctar", "Tuareg",
    "King Krule", "Shame", "Fontaines D.C.",
    "Idles", "Squid", "black midi", "Black Country, New Road",
    "Sorry", "Dry Cleaning", "Goat Girl",
    "Yard Act", "Wet Leg", "Lambrini Girls",

    # ── Country ───────────────────────────────────────────────────────────────
    "Morgan Wallen", "Luke Combs", "Zach Bryan", "Chris Stapleton",
    "Kane Brown", "Carrie Underwood", "Kenny Chesney", "Tim McGraw",
    "Garth Brooks", "George Strait", "Alan Jackson", "Brad Paisley",
    "Blake Shelton", "Miranda Lambert", "Kacey Musgraves", "Maren Morris",
    "Cody Johnson", "Tyler Childers", "Sturgill Simpson", "Jason Isbell",
    "Eric Church", "Luke Bryan", "Florida Georgia Line", "Dan + Shay",
    "Dierks Bentley", "Keith Urban", "Toby Keith", "Brooks & Dunn",
    "Reba McEntire", "Wynonna Judd", "The Judds", "Trisha Yearwood",
    "Shania Twain", "Faith Hill", "LeAnn Rimes", "Martina McBride",
    "Dixie Chicks", "Lady Antebellum", "Little Big Town",
    "Zac Brown Band", "Old Dominion", "Midland", "Turnpike Troubadours",
    "Colter Wall", "Ian Noe", "Andrew Combs", "Charley Crockett",
    "Whitey Morgan", "Hank Williams Jr.", "Waylon Jennings",
    "Willie Nelson", "Johnny Cash", "Merle Haggard", "Buck Owens",
    "Dwight Yoakam", "Randy Travis", "Vince Gill", "Travis Tritt",
    "Jo Dee Messina", "Sara Evans", "Deana Carter",
    "Lainey Wilson", "Carly Pearce", "Ashley McBryde",
    "Caylee Hammack", "Tenille Townes", "Brittney Spencer",
    "Mickey Guyton", "Rissi Palmer", "Chapel Hart",

    # ── Latin ─────────────────────────────────────────────────────────────────
    "Bad Bunny", "J Balvin", "Maluma", "Ozuna", "Daddy Yankee",
    "Shakira", "Enrique Iglesias", "Marc Anthony", "Ricky Martin",
    "Karol G", "Rosalía", "Camilo", "Rauw Alejandro", "Myke Towers",
    "Sech", "Jhay Cortez", "Anuel AA", "Arcangel",
    "Farruko", "Nicky Jam", "Don Omar", "Wisin & Yandel",
    "Luis Fonsi", "Romeo Santos", "Prince Royce", "Aventura",
    "Juan Luis Guerra", "Carlos Vives", "Silvestre Dangond",
    "Calibre 50", "Banda MS", "Los Tigres del Norte",
    "Christian Nodal", "Peso Pluma", "Natanael Cano",
    "Fuerza Regida", "Grupo Frontera", "Eslabon Armado",
    "Junior H", "Xavi", "Yahritza y Su Esencia",
    "Becky G", "Leslie Grace", "Natti Natasha", "Cazzu",
    "Kali Uchis", "Princess Nokia", "Snow tha Product",
    "Cardi B", "Amara La Negra", "La Materialista",

    # ── K-Pop / J-Pop / Asian ─────────────────────────────────────────────────
    "BTS", "BLACKPINK", "Stray Kids", "Twice", "Aespa",
    "EXO", "NCT 127", "NCT Dream", "Red Velvet", "IU",
    "G-Dragon", "BIGBANG", "2NE1", "SHINee", "Girls' Generation",
    "Super Junior", "MONSTA X", "GOT7", "iKON", "WINNER",
    "ATEEZ", "TXT", "Enhypen", "New Jeans", "LE SSERAFIM",
    "IVE", "Kep1er", "NMIXX", "ITZY", "Weeekly",
    "MAMAMOO", "Apink", "AOA", "4Minute", "Sistar",
    "Hyuna", "CL", "Lee Hi", "Zion.T", "Dean",
    "Crush", "Heize", "Suho", "Baekhyun", "Chen",
    "Exo-CBX", "EXO-K", "EXO-M",
    "Utada Hikaru", "Kenshi Yonezu", "Official HIGE DANdism",
    "Yoasobi", "Aimyon", "LiSA", "Aimer",
    "Babymetal", "One OK Rock", "The GazettE",
    "Jay Chou", "Wang Leehom", "JJ Lin", "Eason Chan",

    # ── Afrobeats / Afropop ───────────────────────────────────────────────────
    "Burna Boy", "Wizkid", "Davido", "Rema", "Tems",
    "Fireboy DML", "Omah Lay", "Ayra Starr", "Ckay",
    "Kizz Daniel", "Patoranking", "Simi", "Yemi Alade",
    "Tiwa Savage", "Mr Eazi", "Tekno", "Runtown",
    "Adekunle Gold", "Flavour", "Phyno", "Olamide",
    "Zlatan", "Naira Marley", "Asake", "Seun Kuti",
    "Femi Kuti", "Fela Kuti", "Tony Allen",
    "Stromae", "Aya Nakamura", "Ninho", "Niro",
    "PNL", "Damso", "Booba", "SCH", "Jul",

    # ── Gospel / Christian ────────────────────────────────────────────────────
    "Kirk Franklin", "CeCe Winans", "Tasha Cobbs Leonard",
    "Maverick City Music", "Elevation Worship", "Hillsong United",
    "Hillsong UNITED", "Hillsong Worship", "Bethel Music",
    "Tauren Wells", "For King & Country", "Crowder",
    "Chris Tomlin", "Matt Redman", "Kari Jobe",
    "Lauren Daigle", "Lecrae", "Andy Mineo",
    "KB", "Trip Lee", "Propaganda", "Derek Minor",
    "NF", "Tedashii", "Bizzle", "Social Club Misfits",

    # ── Reggae / Dancehall ────────────────────────────────────────────────────
    "Bob Marley", "Damian Marley", "Stephen Marley",
    "Ziggy Marley", "Bunny Wailer", "Peter Tosh",
    "Toots and the Maytals", "Jimmy Cliff", "Burning Spear",
    "Steel Pulse", "Third World", "Ziggy Marley",
    "Sean Paul", "Shaggy", "Beenie Man", "Bounty Killer",
    "Buju Banton", "Sizzla", "Capleton", "Luciano",
    "Protoje", "Chronixx", "Koffee", "Kabaka Pyramid",
    "Jesse Royal", "Jah9", "Lila Iké",

    # ── Singer-Songwriter / Folk ──────────────────────────────────────────────
    "Bob Dylan", "Neil Young", "Joni Mitchell", "Leonard Cohen",
    "Paul Simon", "James Taylor", "Carole King", "Cat Stevens",
    "Gordon Lightfoot", "John Denver", "Harry Chapin",
    "Jim Croce", "Don McLean", "Townes Van Zandt",
    "Guy Clark", "Steve Earle", "Emmylou Harris",
    "Gillian Welch", "David Rawlings", "John Prine",
    "Iris DeMent", "Nanci Griffith", "Mary Gauthier",
    "Anaïs Mitchell", "Josh Ritter", "Gregory Alan Isakov",
    "Passenger", "Ben Howard", "Ed Sheeran",
    "Vance Joy", "Matt Corby", "Tom Odell",
    "Novo Amor", "Ben Rector", "Andrew Bird",
    "Iron & Wine", "Fleet Foxes", "José González",
    "Nick Mulvey", "Laura Marling", "Lucy Rose",
    "Daughter", "Agnes Obel", "Lisa Hannigan",

    # ── Metal ─────────────────────────────────────────────────────────────────
    "Metallica", "Slayer", "Megadeth", "Anthrax", "Testament",
    "Black Sabbath", "Iron Maiden", "Judas Priest", "Dio",
    "Pantera", "Dimebag Darrell", "Phil Anselmo",
    "Lamb of God", "Machine Head", "Sepultura",
    "Gojira", "Mastodon", "Opeth", "Baroness",
    "Tool", "A Perfect Circle", "Puscifer",
    "Deftones", "Korn", "Slipknot", "Mudvayne",
    "System of a Down", "Serj Tankian", "Rage Against the Machine",
    "Soundgarden", "Alice in Chains", "Queensrÿche",
    "Dream Theater", "Porcupine Tree", "Steven Wilson",
    "Devin Townsend", "Meshuggah", "Periphery", "Animals as Leaders",
    "Architect", "Parkway Drive", "Killswitch Engage",
    "As I Lay Dying", "Hatebreed", "Terror",
    "Power Trip", "Code Orange", "Turnstile",

    # ── Punk ──────────────────────────────────────────────────────────────────
    "The Clash", "Sex Pistols", "Ramones", "Blondie",
    "Television", "Talking Heads", "Patti Smith",
    "Dead Kennedys", "Black Flag", "Minor Threat",
    "Bad Brains", "Husker Du", "The Replacements",
    "Fugazi", "Jawbreaker", "Hot Water Music",
    "Descendents", "Pennywise", "NOFX", "Bad Religion",
    "The Misfits", "Danzig", "Social Distortion",
    "Rancid", "Operation Ivy", "Lagwagon",
    "Alkaline Trio", "Senses Fail", "Finch",
    "Thrice", "Thursday", "The Bouncing Souls",

    # ── Blues ─────────────────────────────────────────────────────────────────
    "B.B. King", "Muddy Waters", "Robert Johnson",
    "Howlin' Wolf", "John Lee Hooker", "Bo Diddley",
    "Chuck Berry", "Little Richard", "Fats Domino",
    "Son House", "Charley Patton", "Skip James",
    "Mississippi John Hurt", "Reverend Gary Davis",
    "Albert King", "Freddie King", "Albert Collins",
    "Stevie Ray Vaughan", "Robert Cray", "Gary Moore",
    "John Mayer", "Joe Bonamassa", "Kenny Wayne Shepherd",
    "Eric Clapton", "Jeff Beck", "Jimmy Page",
]

# Deduplicate while preserving order
seen_names: set[str] = set()
ARTISTS: list[str] = []
for n in ARTIST_NAMES:
    key = n.lower().strip()
    if key not in seen_names:
        seen_names.add(key)
        ARTISTS.append(n)


def _is_rate_limit_error(exc: Exception) -> bool:
    """Spotify returns 429 when rate limited, but also 400 when heavily blocked.
    Both mean 'back off' in the context of the discography endpoint."""
    msg = str(exc)
    return "429" in msg or "400" in msg


async def _fetch_with_backoff(artist_id: str) -> list[dict]:
    """Fetch discography with one short backoff on rate limit errors.

    Does NOT retry multiple times — repeated hammering while rate-limited
    makes the block longer. One attempt, one sleep, one final try.
    """
    try:
        return await spotify_svc.get_artist_albums_limited(artist_id, limit=50) or []
    except Exception as exc:
        if _is_rate_limit_error(exc):
            print(f"  [rate limit] backing off 60s before retry…", flush=True)
            await asyncio.sleep(60)
            # One retry — if this also fails, let the exception propagate
            return await spotify_svc.get_artist_albums_limited(artist_id, limit=50) or []
        raise


# If this many consecutive artists fail, the endpoint is clearly blocked —
# abort this run and let the next deploy try once the bucket has recovered.
CIRCUIT_BREAKER_THRESHOLD = 8


async def seed():
    skipped = 0
    fetched = 0
    failed = 0
    consecutive_failures = 0
    total = len(ARTISTS)
    freshness_cutoff = datetime.utcnow() - timedelta(days=30)

    print(f"[seed] Starting: {total} unique artists", flush=True)
    print(f"[seed] Estimated time: ~{total * 3 // 60} min at 1.5s/call\n", flush=True)

    for i, name in enumerate(ARTISTS, 1):
        # ── Step 1: Search for artist ID ──────────────────────────────────────
        try:
            results = await spotify_svc.search_artists(name, limit=1)
        except Exception as exc:
            print(f"[{i}/{total}] ERROR searching '{name}': {exc}", flush=True)
            failed += 1
            await asyncio.sleep(2)
            continue

        if not results:
            print(f"[{i}/{total}] NOT FOUND: {name}", flush=True)
            failed += 1
            await asyncio.sleep(1.5)
            continue

        artist_id = results[0]["id"]
        resolved_name = results[0].get("name", name)

        # Validate it's actually this artist
        if resolved_name.lower() != name.lower():
            print(f"[{i}/{total}] MISMATCH: searched '{name}', got '{resolved_name}' — skipping", flush=True)
            await asyncio.sleep(1.5)
            continue

        # ── Step 2: Check freshness ────────────────────────────────────────────
        async with AsyncSessionLocal() as session:
            artist_row = (await session.execute(
                select(ArtistCache).where(ArtistCache.spotify_id == artist_id)
            )).scalar_one_or_none()

            if (
                artist_row is not None
                and artist_row.discography_fetched_at is not None
                and artist_row.discography_fetched_at > freshness_cutoff
            ):
                print(f"[{i}/{total}] SKIP (fresh): {name}", flush=True)
                skipped += 1
                await asyncio.sleep(0.3)
                continue

        # ── Step 3: Fetch discography ──────────────────────────────────────────
        await asyncio.sleep(1.5)

        try:
            albums = await _fetch_with_backoff(artist_id)
        except Exception as exc:
            print(f"[{i}/{total}] ERROR fetching '{name}': {exc}", flush=True)
            failed += 1
            consecutive_failures += 1
            if consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD:
                print(
                    f"\n[seed] Circuit breaker: {consecutive_failures} consecutive failures — "
                    f"endpoint is blocked. Aborting this run; next deploy will retry.",
                    flush=True
                )
                break
            await asyncio.sleep(5)
            continue

        if not albums:
            print(f"[{i}/{total}] EMPTY: {name}", flush=True)
            failed += 1
            consecutive_failures += 1
            if consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD:
                print(
                    f"\n[seed] Circuit breaker triggered on empty responses. Aborting.",
                    flush=True
                )
                break
            await asyncio.sleep(1.5)
            continue

        consecutive_failures = 0  # reset on any success

        # ── Step 4: Persist ────────────────────────────────────────────────────
        async with AsyncSessionLocal() as session:
            new_count = 0
            for a in albums:
                existing = (await session.execute(
                    select(AlbumCacheModel).where(AlbumCacheModel.spotify_id == a["id"])
                )).scalar_one_or_none()
                if existing is None:
                    primary_artist = a.get("artists", [resolved_name])[0]
                    session.add(AlbumCacheModel(
                        spotify_id=a["id"],
                        name=a["name"],
                        artist=primary_artist,
                        release_date=a.get("release_date"),
                        release_date_precision=a.get("release_date_precision"),
                        popularity=a.get("popularity"),
                        image_url=a.get("image_url"),
                        enrichment_status="pending",
                    ))
                    new_count += 1

            artist_row = (await session.execute(
                select(ArtistCache).where(ArtistCache.spotify_id == artist_id)
            )).scalar_one_or_none()
            if artist_row:
                artist_row.discography_fetched_at = datetime.utcnow()
                artist_row.name = resolved_name
            else:
                session.add(ArtistCache(
                    spotify_id=artist_id,
                    name=resolved_name,
                    discography_fetched_at=datetime.utcnow(),
                ))
            await session.commit()

        fetched += 1
        print(f"[{i}/{total}] OK  {name} — {len(albums)} albums, {new_count} new", flush=True)

        await asyncio.sleep(1.5)

    print(f"\n[seed] Done — fetched={fetched}, skipped={skipped}, failed={failed}/{total}", flush=True)


if __name__ == "__main__":
    asyncio.run(seed())
