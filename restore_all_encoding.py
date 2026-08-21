#!/usr/bin/env python3
# coding: utf-8
"""Restore UTF-8 encoding in ReadyExpressNow frontend files."""

import os

def restore_file(filepath):
    """Restore UTF-8 in a file by reading with latin-1 and rewriting with UTF-8."""
    try:
        with open(filepath, 'r', encoding='latin-1') as f:
            content = f.read()

        # Remove BOM
        if content.startswith('﻿') or content.startswith('\xef\xbb\xbf'):
            content = content[1:]

        # Build replacements dictionary
        repl = {}

        # Emoji mappings (using hex escapes for corrupted sequences)
        repl['Ã°Å¸ÂÂ±'] = '🥡'  # Combo box
        repl['ð¥©'] = '🥩'       # Meat
        repl['Ã°Å¸Ââ'] = '🍗'   # Chicken
        repl['ð¾'] = '🌾'        # Grains
        repl['ð«'] = '🫙'        # Jug
        repl['ð¥'] = '🥛'        # Milk
        repl['ð§´'] = '🧴'       # Soap
        repl['ð¥¤'] = '🥤'       # Beverage
        repl['Ã°Å¸âºâ'] = '🛍'  # Shopping
        repl['Ã¢Å¡Â¡'] = '⚡'   # Lightning
        repl['Ã°Å¸âÂ¦'] = '📦'  # Package
        repl['Ã°Å¸âÂ±'] = '📱'  # Phone
        repl['Ã°Å¸âÂ¢'] = '📢'  # Speaker
        repl['Ã°Å¸â'] = '📍'    # Pin
        repl['Ã°Å¸Â‰'] = '🕐'   # Clock
        repl['Ã°Å¸â¡'] = '📡'   # Satellite
        repl['Ã°Å¸âº'] = '📸'   # Camera
        repl['Ã¢ÂÅ '] = '❌'    # X mark
        repl['Ã¢ÂÅ'] = '❌'     # X mark
        repl['Ã¢Å¡Â '] = '⚠'    # Warning
        repl['Ã¯Â¸Â '] = ''      # Variation
        repl['Ã¢Å¡Â'] = '⚠'     # Warning
        repl['âœ…'] = '✅'        # Check
        repl['âœ•'] = '✕'        # X
        repl['âŒ'] = '❌'         # X
        repl['â±ï¸'] = '⏱'       # Timer
        repl['Â·'] = '·'          # Dot
        repl['â"€â"€'] = '--'      # Dash
        repl['½"?½"?'] = '--'     # Dash
        repl['½~½'] = '☰'        # Menu
        repl['½Y>'] = '🛒'       # Cart
        repl['½Y\''] = '🛒'      # Cart
        repl['½Y\'½'] = '📱'     # Phone

        # Spanish accents
        repl['Ã¡'] = 'á'
        repl['Ã©'] = 'é'
        repl['Ã­'] = 'í'
        repl['Ã³'] = 'ó'
        repl['Ã¹'] = 'ú'
        repl['Ã'] = 'Á'
        repl['Ã‰'] = 'É'
        repl['Ã'] = 'Í'
        repl['Ã"'] = 'Ó'
        repl['Ãš'] = 'Ú'
        repl['Â¿'] = '¿'
        repl['Â¡'] = '¡'
        repl['Ã±'] = 'ñ'
        repl['Ã„'] = 'Ä'

        # Common phrases
        repl['EnvÃ­a'] = 'Envía'
        repl['GuantÃ¡namo'] = 'Guantánamo'
        repl['Â¿CÃ³mo'] = '¿Cómo'
        repl['QuÃ­enes'] = 'Quiénes'
        repl['CÃ³mo'] = 'Cómo'
        repl['MenÃº'] = 'Menú'
        repl['telÃ©fono'] = 'teléfono'
        repl['telÃ©fonos'] = 'teléfonos'
        repl['direcciÃ³n'] = 'dirección'
        repl['validaciÃ³n'] = 'validación'
        repl['vÃ¡lido'] = 'válido'
        repl['EnvÃ­o'] = 'Envío'
        repl['ComprobanteÂ'] = 'Comprobante'
        repl['polÃ­tica'] = 'política'
        repl['tÃ©rminos'] = 'términos'

        # Apply all replacements
        for corrupted, correct in repl.items():
            content = content.replace(corrupted, correct)

        # Write back
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)

        print('OK: ' + os.path.basename(filepath))
        return True
    except Exception as e:
        print('ERR: ' + os.path.basename(filepath) + ' - ' + str(e))
        return False

def main():
    base = r'c:\Users\100270999\Documents\PRPOGRAMACION\ReadyExpressNow\frontend'
    files = [
        'index.html',
        'pago.html',
        'ayuda.html',
        'quienes-somos.html',
        'terminos.html',
        'politica-privacidad.html',
        'js/products.js',
        'js/payment.js',
        'js/cart.js',
        'js/checkout.js',
        'js/api.js',
    ]

    print('Starting restoration...\n')
    ok = fail = 0

    for fname in files:
        fpath = os.path.join(base, fname)
        if os.path.exists(fpath):
            if restore_file(fpath):
                ok += 1
            else:
                fail += 1

    print('\n' + '='*50)
    print('Done: %d OK, %d FAILED' % (ok, fail))
    print('='*50)

if __name__ == '__main__':
    main()
