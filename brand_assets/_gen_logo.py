#!/usr/bin/env python3
"""Amygdala logo lockups — embeds the mascot PNG (transparent) as base64."""
import base64
b64 = base64.b64encode(open("mascot-256.png","rb").read()).decode()
IMG = "data:image/png;base64,"+b64
# mascot-256 is 256x319 (aspect 0.802)
def img(x,y,h):
    w = h*0.802
    return '<image href="%s" x="%.1f" y="%.1f" width="%.1f" height="%.1f"/>'%(IMG,x,y,w,h)

scan=('<pattern id="scan" width="1" height="3" patternUnits="userSpaceOnUse">'
      '<rect width="1" height="1.2" y="1.8" fill="rgba(0,0,0,0.35)"/></pattern>')
glow=('<filter id="tg" x="-20%" y="-40%" width="140%" height="180%">'
      '<feGaussianBlur stdDeviation="3" result="b"/><feMerge>'
      '<feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>')

# ---- horizontal lockup ----
W,H=900,260
s=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d">'%(W,H),
   '<defs>%s%s</defs>'%(scan,glow),
   '<rect x="6" y="6" width="%d" height="%d" rx="26" fill="#020504" stroke="#0A3D22" stroke-width="3"/>'%(W-12,H-12),
   '<rect x="20" y="20" width="%d" height="%d" rx="16" fill="#05090B" stroke="rgba(61,240,122,0.35)" stroke-width="1.5"/>'%(W-40,H-40),
   '<rect x="20" y="20" width="%d" height="%d" rx="16" fill="url(#scan)"/>'%(W-40,H-40),
   '<rect x="20" y="20" width="%d" height="%d" rx="16" fill="none" stroke="rgba(61,240,122,0.5)" stroke-width="1" filter="url(#tg)"/>'%(W-40,H-40),
   img(44,44,178),
   '<g filter="url(#tg)">',
   '<text x="238" y="96" font-size="24" fill="#FFC24D" letter-spacing="9" '
   'font-family="VT323, monospace">RETRO CARD ROOMS</text>',
   '<line x1="240" y1="110" x2="812" y2="110" stroke="rgba(255,194,77,0.4)" stroke-width="1"/>',
   '<text x="236" y="196" font-size="86" fill="#C6FFDA" letter-spacing="-2" '
   'font-family="Amoria, VT323, serif">AMYGDALA</text>',
   '</g>',
   '<g font-family="VT323, monospace" font-size="30">'
   '<text x="846" y="120" fill="#3DF07A" text-anchor="middle">&#9824;</text>'
   '<text x="846" y="156" fill="none" stroke="#3DF07A" stroke-width="1" text-anchor="middle">&#9829;</text></g>',
   '</svg>']
open("logo.svg","w").write("\n".join(s))

# ---- square app mark ----
s2=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">',
   '<defs>%s</defs>'%glow,
   '<rect x="6" y="6" width="228" height="228" rx="34" fill="#05090B" stroke="#3DF07A" stroke-width="3"/>',
   '<rect x="6" y="6" width="228" height="228" rx="34" fill="url(#scan)"/>' if False else '',
   img(66,26,150),
   '<text x="120" y="212" font-family="Amoria, VT323, serif" font-size="30" '
   'fill="#C6FFDA" text-anchor="middle" letter-spacing="1" filter="url(#tg)">AMYGDALA</text>',
   '</svg>']
open("logo-mark.svg","w").write("\n".join([x for x in s2 if x]))
print("wrote logo.svg + logo-mark.svg")
