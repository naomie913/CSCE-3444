"""Hallway center lines traced from the official Discovery Park floor map PDF.

Coordinates are PDF points on that floor's page (612 x 792). The two floors are
drawn at different positions on their pages, so their coordinates don't line up;
stairs and elevators connect the floors by number instead.

Each hallway: (id, wing, label used in directions, admin name, (x1, y1), (x2, y2)).
`wing` is the wing letter, or "C" for shared hallways. Hallways that meet must
touch: an endpoint lying on another hallway, or two hallways crossing, becomes a
junction automatically. Edit these and re-run tools/build_map.py.
"""

MAIN1 = "main hallway (C136)"
SOUTH1 = "south hallway (C104)"
MAIN2 = "main hallway (C236)"
SOUTH2 = "south hallway (C211)"

CORRIDORS = {
    1: [
        # Shared hallways
        ("c136-w", "C", MAIN1, "C136 main hallway, Wing K to Wing G", (62, 349), (290, 349)),
        ("c136-e", "C", MAIN1, "C136 main hallway, Wing G to Wing B/D", (290, 349), (418, 347)),
        ("c104", "C", SOUTH1, "C104 south hallway, Wing B to Wing M", (323, 485), (545, 485)),
        ("c119", "C", "hallway by C119", "Hallway by C119 (east stairs)", (535, 450), (535, 485)),
        # Wing K
        ("k-v", "K", "Wing K hallway", "Wing K hallway (north-south)", (88, 296), (88, 349)),
        ("k-h", "K", "Wing K hallway", "Wing K hallway by K130", (88, 321), (128, 321)),
        # Wing E
        ("e-w", "E", "Wing E west hallway", "Wing E west hallway", (139, 349), (139, 508)),
        ("e-e", "E", "Wing E east hallway", "Wing E east hallway", (256, 349), (256, 508)),
        ("e-365", "E", "Wing E north hallway", "Wing E north hallway by E132-E148", (139, 365.5), (256, 365.5)),
        ("e-402", "E", "Wing E hallway", "Wing E hallway by E135-E139", (139, 402), (256, 402)),
        ("e-423", "E", "Wing E hallway", "Wing E hallway by E157-E160", (139, 423), (256, 423)),
        ("e-455", "E", "Wing E hallway", "Wing E hallway by E166/E180A", (139, 455), (256, 455)),
        ("e-508", "E", "Wing E south hallway", "Wing E south hallway", (139, 508), (256, 508)),
        ("e-157", "E", "Wing E hallway", "Wing E hallway by E161-E167", (157, 423), (157, 455)),
        ("e-200", "E", "Wing E hallway", "Wing E hallway by E154", (200, 423), (200, 455)),
        ("e-205", "E", "Wing E hallway", "Wing E hallway by E178", (205, 455), (205, 508)),
        # Wing G: a loop of two diagonal strips joined at the top (exact, from the PDF's shapes)
        ("g-in", "G", "Wing G hallway", "Wing G entry from C136 (through the G150 lobby)", (255.5, 349), (255.5, 334)),
        ("g-left", "G", "Wing G hallway", "Wing G west diagonal (G152-G163)", (255.5, 334), (227.6, 291)),
        ("g-west", "G", "Wing G hallway", "Wing G hallway by G165 (assumed; not shaded on map)", (227.6, 291), (227.7, 266)),
        ("g-top", "G", "Wing G hallway", "Wing G north hallway by G195 (assumed; not shaded on map)", (227.7, 266), (249.3, 264.6)),
        ("g-east", "G", "Wing G hallway", "Wing G hallway by G181-G191 (assumed; not shaded on map)", (249.3, 264.6), (249.8, 297.7)),
        ("g-right", "G", "Wing G hallway", "Wing G east diagonal (G170-G178)", (249.8, 297.7), (264.8, 323.5)),
        ("g-join", "G", "Wing G hallway", "Wing G south junction", (264.8, 323.5), (255.5, 334)),
        # Wing H
        ("h", "H", "Wing H hallway", "Wing H hallway", (317, 135), (317, 349)),
        ("h-stub", "H", "Wing H hallway", "Wing H side hallway", (290, 215), (317, 215)),
        # Wing D / J
        ("d-296", "D", "Wing D hallway", "Wing D hallway by D133-D144", (317, 296), (412, 296)),
        ("d-356", "D", "Wing D north hallway", "Wing D north hallway (D160, to Wing J)", (356, 228), (356, 296)),
        ("d-412", "D", "Wing D east hallway", "Wing D east hallway", (412, 296), (412, 347)),
        # The map shows no hallway inside Wing J. This assumes it's entered from the top of
        # the D160 hallway through the small rooms beside J101. Check on site.
        ("j", "J", "Wing J hallway", "Wing J entry from D160 (assumed)", (353.2, 231), (379, 231)),
        ("j-up", "J", "Wing J hallway", "Wing J hallway by J101/J105 (assumed)", (379, 231), (379, 198)),
        # Wing B
        ("b-w", "B", "Wing B west hallway", "Wing B west hallway", (323, 347), (323, 485)),
        ("b-e", "B", "Wing B east hallway", "Wing B east hallway", (405, 346), (405, 485)),
        ("b-395", "B", "Wing B hallway", "Wing B hallway by B157/B131", (323, 395), (405, 395)),
        ("b-433", "B", "Wing B hallway", "Wing B hallway by B158/B185", (323, 433), (405, 433)),
        # Wing A
        ("a", "A", "Wing A hallway", "Wing A hallway", (338, 485), (338, 580)),
        ("a-s", "A", "Wing A hallway", "Wing A south hallway to the entrance", (338.8, 576), (325.5, 576)),
        ("a-516", "A", "Wing A inner hallway", "Wing A inner hallway by A160", (294, 516), (338, 516)),
        ("a-306", "A", "Wing A inner hallway", "Wing A inner hallway by A145/A149", (306, 516), (306, 541)),
        # Wing F
        ("f-w", "F", "Wing F west hallway", "Wing F west hallway", (407, 485), (407, 652)),
        ("f-e", "F", "Wing F east hallway", "Wing F east hallway", (520, 485), (520, 650)),
        ("f-532", "F", "Wing F hallway", "Wing F cross hallway by F102", (407, 532), (520, 532)),
        ("f-455", "F", "Wing F hallway", "Wing F hallway by F162", (455, 532), (455, 652)),
        ("f-559", "F", "Wing F hallway", "Wing F hallway by F179/F175", (455, 559), (520, 559)),
        ("f-596", "F", "Wing F hallway", "Wing F hallway by F183/F180", (455, 596), (520, 596)),
        ("f-496", "F", "Wing F hallway", "Wing F hallway by F185/F181", (496, 596), (496, 650)),
        ("f-650", "F", "Wing F south hallway", "Wing F south hallway", (455, 650), (520, 650)),
    ],
    2: [
        # Shared hallways
        ("c236", "C", MAIN2, "C236 main hallway, Wing K to Wing D", (27, 220), (437, 220)),
        ("c211", "C", SOUTH2, "C211 south hallway, Wing B to Wing F", (327, 383), (590, 383)),
        ("c219", "C", "hallway by C219", "Hallway by C219 (east stairs)", (590, 360), (590, 383)),
        # Wing K
        ("k2-v", "K", "Wing K hallway", "Wing K hallway (north-south)", (51, 158), (51, 220)),
        # Wing E
        ("e2-w", "E", "Wing E west hallway", "Wing E west hallway", (111, 220), (111, 405)),
        ("e2-e", "E", "Wing E east hallway", "Wing E east hallway", (249, 220), (249, 405)),
        ("e2-405", "E", "Wing E south hallway", "Wing E south hallway", (111, 405), (249, 405)),
        ("e2-200", "E", "Wing E hallway", "Wing E hallway by E290", (200, 220), (200, 306)),
        ("e2-251", "E", "Wing E hallway", "Wing E hallway by E292", (200, 251), (249, 251)),
        ("e2-265", "E", "Wing E hallway", "Wing E hallway by E295", (200, 265), (249, 265)),
        ("e2-306", "E", "Wing E hallway", "Wing E hallway by E298", (200, 306), (249, 306)),
        ("e2-176", "E", "Wing E hallway", "Wing E hallway by E216", (176, 266), (176, 329)),
        ("e2-287", "E", "Wing E hallway", "Wing E hallway E215", (111, 287), (176, 287)),
        ("e2-308", "E", "Wing E hallway", "Wing E hallway E225", (111, 308), (176, 308)),
        ("e2-329", "E", "Wing E hallway", "Wing E hallway E235/E236", (111, 329), (249, 329)),
        ("e2-349", "E", "Wing E hallway", "Wing E hallway E245/E250", (111, 349), (249, 349)),
        ("e2-370", "E", "Wing E hallway", "Wing E hallway E255/E260", (111, 370), (249, 370)),
        # Wing D
        ("d2-163", "D", "Wing D hallway", "Wing D hallway by D206-D210", (330, 163), (437, 163)),
        ("d2-355", "D", "Wing D north hallway", "Wing D narrow hallway beside D206A", (355.2, 165.8), (355.2, 123)),
        ("d2-123", "D", "Wing D north hallway", "Wing D north hallway corner", (355.2, 123), (362.5, 123)),
        ("d2-362", "D", "Wing D north hallway", "Wing D north hallway by D265", (362.5, 123), (362.5, 85)),
        ("d2-352", "D", "Wing D west hallway", "Wing D west hallway by D202", (352, 163), (352, 220)),
        ("d2-432", "D", "Wing D east hallway", "Wing D east hallway", (432, 163), (432, 220)),
        # Wing B
        ("b2-w", "B", "Wing B west hallway", "Wing B west hallway", (327, 220), (327, 383)),
        ("b2-e", "B", "Wing B east hallway", "Wing B east hallway", (417, 220), (417, 383)),
        ("b2-274", "B", "Wing B hallway", "Wing B hallway by B230-B260", (327, 274), (417, 274)),
        ("b2-325", "B", "Wing B hallway", "Wing B hallway by B236/B270", (327, 325), (417, 325)),
        ("b2-404", "B", "Wing B hallway", "Wing B narrow hallway by B260-B265", (404.5, 274), (404.5, 325)),
        # Wing F
        ("f2-w", "F", "Wing F west hallway", "Wing F west hallway", (420, 383), (420, 575)),
        ("f2-e", "F", "Wing F east hallway", "Wing F east hallway", (561, 383), (561, 575)),
        ("f2-c", "F", "Wing F center hallway", "Wing F center hallway", (491, 383), (491, 575)),
        # The west and east halves of Wing F have their cross hallways at different heights.
        ("f2-432", "F", "Wing F hallway", "Wing F hallway by F222/F219 (west half)", (420, 432.2), (491, 432.2)),
        ("f2-429", "F", "Wing F hallway", "Wing F hallway by F216/F210 (east half)", (491, 428.8), (561, 428.8)),
        ("f2-471", "F", "Wing F hallway", "Wing F hallway by F232/F242", (420, 471), (561, 471)),
        ("f2-503", "F", "Wing F hallway", "Wing F hallway by F254/F247 (west half)", (420, 503), (491, 503)),
        ("f2-514", "F", "Wing F hallway", "Wing F hallway by F260/F288 (east half)", (491, 514.2), (561, 514.2)),
        ("f2-534", "F", "Wing F hallway", "Wing F hallway by F268/F253 (west half)", (420, 534.5), (491, 534.5)),
        ("f2-575", "F", "Wing F south hallway", "Wing F south hallway", (420, 575), (561, 575)),
    ],
}

# Hallways traced exactly from the PDF's shapes (or deliberately assumed), which the
# build must not slide around when it lines hallways up with the map's gray areas.
EXACT = {"a-s", "e-365", "g-in", "g-left", "g-west", "g-top", "g-east", "g-right", "g-join", "j", "j-up",
         "b2-404", "d2-355", "d2-123", "d2-362",
         "f2-432", "f2-429", "f2-471", "f2-503", "f2-514", "f2-534", "f2-575"}

# Public entrances (approximate: where outside walkways reach the building).
# (id, label, (x, y) of the door, hallway id it opens onto)
ENTRANCES = {
    1: [
        ("entrance-east", "East entrance", (426, 347), "c136-e"),
        ("entrance-south", "South entrance (Wing A)", (325.5, 590), "a-s"),
        ("entrance-north", "North entrance (Wing K)", (125, 310), "k-h"),
    ],
    2: [],
}

# Places named on the map. Text to look for on the page, and the room numbers in
# the same space. If none of those numbers is on the map, the first one is used
# as the place's id (e.g. PERKS) so it can still be searched and routed to.
# (floor, search text, display name, wing, type, room numbers or id)
NAMED_PLACES = [
    (1, "Library", "Discovery Park Library", "B", "study", ["B112"]),
    (1, "Perks", "Discovery Perks Market & Grill", "G", "cafeteria", ["PERKS"]),
    (1, "Central", "Central Receiving", "H", "office", ["RECEIVING"]),
    (1, "CENG", "CENG IT Services", "B", "office", ["B187"]),
    (1, "Agile", "Center for Agile and Adaptive Additive Manufacturing", "E", "lab", ["E180A"]),
    (1, "Materials", "Materials Research Facility", "E", "lab", ["E178"]),
    (1, "Engineering", "Engineering Manufacturing Facility", "F", "lab", ["F160"]),
    (1, "Pettinger", "Pettinger Center for Design & Innovation", "M", "lab", ["PETTINGER"]),
    (1, "Co/Lab", "Co/Lab", "M", "lab", ["COLAB"]),
    (1, "AR/VR", "AR/VR Lab", "M", "lab", ["ARVR"]),
    (2, "Career", "Career Center & College of Engineering Student Success Center", "E", "office", ["E201"]),
    (2, "Advising", "College of Information Advising", "C", "office", ["C232"]),
]

# Feet per PDF point on each floor. ESTIMATES until the team measures a hallway:
# measure one hallway in feet, divide by its length in points, and update.
FEET_PER_UNIT = {1: 3.0, 2: 2.75}
