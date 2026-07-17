#!/usr/bin/env python3
"""Amygdala sample cards. Suit legibility in a monochrome palette is
solved by a filled-vs-outlined rule (PRD 5.6): spades & clubs render SOLID,
hearts & diamonds render OUTLINED, always paired with the rank letter."""

G="#3DF07A"; B="#C6FFDA"; BG="#05090B"; PANEL="#081410"; DIM="#125C33"

# suit paths in a 0..100 box
SUIT={
"spade":"M50 10 C74 40 94 52 94 70 A16 16 0 0 1 60 74 C60 82 64 88 72 92 L28 92 C36 88 40 82 40 74 A16 16 0 0 1 6 70 C6 52 26 40 50 10 Z",
"heart":"M50 90 C16 62 6 46 6 30 A20 20 0 0 1 50 26 A20 20 0 0 1 94 30 C94 46 84 62 50 90 Z",
"diamond":"M50 6 L90 50 L50 94 L10 50 Z",
"club":"M50 8 A15 15 0 1 1 49 38 A16 16 0 1 1 33 62 A16 16 0 1 1 67 62 A16 15 0 1 1 51 38 L58 88 L42 88 Z",
}
FILLED={"spade","club"}   # solid
# hearts, diamonds -> outlined

CW,CH,R=150,210,14
def card(x,rank,suit):
    solid = suit in FILLED
    glyph_style = ('fill="%s"'%G) if solid else ('fill="none" stroke="%s" stroke-width="6"'%G)
    mini_style  = ('fill="%s"'%G) if solid else ('fill="none" stroke="%s" stroke-width="9"'%G)
    s=[]
    # card body
    s.append('<g transform="translate(%d,0)">'%x)
    s.append('<rect x="0" y="0" width="%d" height="%d" rx="%d" fill="%s" '
             'stroke="%s" stroke-width="2"/>'%(CW,CH,R,PANEL,G))
    s.append('<rect x="5" y="5" width="%d" height="%d" rx="%d" fill="none" '
             'stroke="rgba(61,240,122,0.25)" stroke-width="1"/>'%(CW-10,CH-10,R-4))
    # top-left rank + mini suit
    s.append('<text x="16" y="34" font-family="VT323, monospace" font-size="34" '
             'fill="%s">%s</text>'%(B,rank))
    s.append('<g transform="translate(15,40) scale(0.16)">'
             '<path d="%s" %s/></g>'%(SUIT[suit],mini_style))
    # bottom-right (rotated 180)
    s.append('<g transform="translate(%d,%d) rotate(180)">'%(CW,CH))
    s.append('<text x="16" y="34" font-family="VT323, monospace" font-size="34" '
             'fill="%s">%s</text>'%(B,rank))
    s.append('<g transform="translate(15,40) scale(0.16)">'
             '<path d="%s" %s/></g></g>'%(SUIT[suit],mini_style))
    # center glyph
    s.append('<g transform="translate(%d,%d) scale(0.62)">'
             '<path d="%s" %s/></g>'%(CW/2-31,CH/2-31,SUIT[suit],glyph_style))
    s.append('</g>')
    return "\n".join(s)

def back(x):
    s=['<g transform="translate(%d,0)">'%x,
       '<rect x="0" y="0" width="%d" height="%d" rx="%d" fill="%s" stroke="%s" stroke-width="2"/>'%(CW,CH,R,PANEL,G),
       '<rect x="10" y="10" width="%d" height="%d" rx="%d" fill="none" stroke="%s" stroke-width="1.5"/>'%(CW-20,CH-20,R-4,DIM)]
    # dot-grid phosphor pattern + dog monogram
    for gy in range(24,CH-18,18):
        for gx in range(22,CW-16,18):
            s.append('<rect x="%d" y="%d" width="4" height="4" fill="rgba(61,240,122,0.35)"/>'%(gx,gy))
    s.append('<circle cx="%d" cy="%d" r="30" fill="%s" stroke="%s" stroke-width="2"/>'%(CW/2,CH/2,BG,G))
    s.append('<text x="%d" y="%d" font-family="VT323, monospace" font-size="30" '
             'fill="%s" text-anchor="middle">A</text>'%(CW/2,CH/2+10,B))
    s.append('</g>')
    return "\n".join(s)

cards=[("A","spade"),("K","heart"),("Q","diamond"),("J","club")]
gap=26; x=gap
labels_h=30
total_w=gap+(CW+gap)*(len(cards)+1)
total_h=CH+labels_h+gap*2
out=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d">'%(total_w,total_h),
     '<defs><filter id="g" x="-30%%" y="-30%%" width="160%%" height="160%%">'
     '<feGaussianBlur stdDeviation="1.4" result="b"/><feMerge>'
     '<feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>',
     '<rect width="%d" height="%d" fill="%s"/>'%(total_w,total_h,BG),
     '<g filter="url(#g)" transform="translate(0,%d)">'%gap]
tags=[]
for rank,suit in cards:
    out.append(card(x,rank,suit))
    tags.append((x+CW/2, "%s%s %s"%(rank,{"spade":"♠","heart":"♥","diamond":"♦","club":"♣"}[suit],
                 "SOLID" if suit in FILLED else "OUTLINE")))
    x+=CW+gap
out.append(back(x)); tags.append((x+CW/2,"BACK"))
out.append('</g>')
for cx,label in tags:
    out.append('<text x="%d" y="%d" font-family="VT323, monospace" font-size="18" '
               'fill="%s" text-anchor="middle">%s</text>'%(cx,CH+gap+24,G,label))
out.append('</svg>')
open("cards.svg","w").write("\n".join(out))
print("wrote cards.svg")
