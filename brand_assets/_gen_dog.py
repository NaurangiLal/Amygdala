#!/usr/bin/env python3
"""Amygdala mascot — narrator state board (PRD 5.5). One master mascot mapped to
eight dog states, each with a data-driven sample line. Mascot is embedded once
(base64 symbol + <use>) so the SVG renders standalone AND inside <img>."""
import base64
b64=base64.b64encode(open("mascot-160.png","rb").read()).decode()
AR=875/1091.0  # w/h
STATES=[
("idle","~","just us and the felt.",1.0),
("explaining","?","don't bust past 21.",1.0),
("prompting","!","your move - hit or stand?",1.0),
("thinking","...","dealer's cooking...",0.92),
("reacting_win","+","tail-wag! that's yours.",1.0),
("reacting_loss","v","tough hand. next time.",0.70),
("reacting_neutral","=","a push - we go again.",0.85),
("celebrating","*","you cleaned up!",1.0),
]
COLS,CW,CH,PAD,LH=4,206,208,16,64
W=COLS*CW+(COLS+1)*PAD; ROWS=2; Hh=ROWS*(CH+LH)+(ROWS+1)*PAD

defs=('<symbol id="dog" viewBox="0 0 160 199">'
      '<image href="data:image/png;base64,%s" width="160" height="199"/></symbol>'%b64+
 '<filter id="win" x="-30%" y="-30%" width="160%" height="160%">'
 '<feComponentTransfer><feFuncR type="linear" slope="1.15"/>'
 '<feFuncG type="linear" slope="1.15"/><feFuncB type="linear" slope="1.15"/>'
 '</feComponentTransfer></filter>')

def cell(i,st):
    name,emote,line,op=st
    cx=PAD+(i%COLS)*(CW+PAD); cy=PAD+(i//COLS)*(CH+LH+PAD)
    mh=112; mw=mh*AR; mx=cx+CW/2-mw/2; my=cy+16
    hot=name in ("reacting_win","celebrating")
    filt=' filter="url(#win)"' if hot else ''
    s=['<rect x="%d" y="%d" width="%d" height="%d" rx="10" fill="#081410" stroke="rgba(61,240,122,0.22)"/>'%(cx,cy,CW,CH)]
    if hot:
        s.append('<rect x="%d" y="%d" width="%d" height="%d" rx="10" fill="none" stroke="rgba(198,255,218,0.5)" stroke-width="1.5"/>'%(cx+2,cy+2,CW-4,CH-4))
    s.append('<use href="#dog" x="%.1f" y="%.1f" width="%.1f" height="%.1f" opacity="%.2f"%s/>'%(mx,my,mw,mh,op,filt))
    s.append('<circle cx="%d" cy="%d" r="15" fill="#05090B" stroke="#3DF07A"/>'%(cx+CW-24,cy+24))
    s.append('<text x="%d" y="%d" font-family="VT323, monospace" font-size="22" fill="#C6FFDA" text-anchor="middle">%s</text>'%(cx+CW-24,cy+31,emote))
    s.append('<text x="%d" y="%d" font-family="VT323, monospace" font-size="19" fill="#3DF07A" text-anchor="middle" letter-spacing="1">%s</text>'%(cx+CW/2,cy+CH-14,name))
    s.append('<text x="%d" y="%d" font-family="VT323, monospace" font-size="15" fill="#1A7A40" text-anchor="middle">%s</text>'%(cx+CW/2,cy+CH+26,line[:36]))
    return "\n".join(s)

out=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d">'%(W,Hh),
     '<defs>%s</defs>'%defs,'<rect width="%d" height="%d" fill="#05090B"/>'%(W,Hh)]
for i,st in enumerate(STATES): out.append(cell(i,st))
out.append('</svg>')
open("dog-sprite.svg","w").write("\n".join(out))
open("dog.svg","w").write(
 '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 199"><defs>%s</defs>'
 '<use href="#dog" width="160" height="199"/></svg>'%defs)
print("wrote self-contained dog-sprite.svg + dog.svg")
