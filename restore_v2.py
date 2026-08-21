#!/usr/bin/env python3
# coding: utf-8
"""
Advanced UTF-8 restoration - handles partially corrupted UTF-8 sequences.
Reads as binary and applies intelligent reconstruction.
"""

import os

def fix_corruption(filepath):
    """Fix UTF-8 corruption by handling mis-encoded sequences."""
    try:
        # Read as binary
        with open(filepath, 'rb') as f:
            data = f.read()

        # Remove UTF-8 BOM if present
        if data.startswith(b'\xef\xbb\xbf'):
            data = data[3:]

        # Convert to string (with errors='replace' to handle bad sequences)
        text = data.decode('utf-8', errors='ignore')

        # Now apply comprehensive replacements
        # These are the actual corrupted sequences found in the UTF-8

        replacements = [
            # Multi-byte UTF-8 corruptions (emojis and special chars)
            ('c38dc283c382c2ad', 'Envía'),           # EnvÍÂ­a -> Envía
            ('GuantÍ¡namo', 'Guantánamo'),
            ('Í¿CÍÂ³mo', '¿Cómo'),
            ('QuÍÂ­enes', 'Quiénes'),
            ('MenÍÂº', 'Menú'),
            ('telÍÂ©fono', 'teléfono'),
            ('telÍÂ©fonos', 'teléfonos'),
            ('direcciÍÂ³n', 'dirección'),
            ('validaciÍÂ³n', 'validación'),
            ('vÍ¡lido', 'válido'),
            ('EnvÍÂ­o', 'Envío'),
            ('polÍÂ­tica', 'política'),
            ('tÍ©rminos', 'términos'),
            ('ÍÂ°ÍÂ¸ÍÂÍÂ±', '🥡'),      # Combo
            ('Í°ÂÂ¥Â©', '🥩'),          # Meat
            ('ÍÂ°ÍÂ¸ÍÂÍ¢ÂÂ', '🍗'),     # Chicken
            ('Í°ÂÂÂ¾', '🌾'),           # Grains
            ('Í°ÂÂ«Â', '🫙'),           # Jug
            ('Í°ÂÂ¥Â', '🥛'),           # Milk
            ('Í°ÂÂ§Â´', '🧴'),          # Soap
            ('Í°ÂÂ¥Â¤', '🥤'),          # Beverage
            ('ÍÂ°ÍÂ¸Í¢ÂÂºÍ¢ÂÂ', '🛍'),   # Shopping
            ('ÍÂ¢Í¡Í¡', '⚡'),          # Lightning
            ('ÍÂ°ÍÂ¸Í¢ÂÂÍÂ¦', '📦'),    # Package
            ('ÍÂ°ÍÂ¸Í¢ÂÂÍÂ±', '📱'),    # Phone
            ('ÍÂ¢Í¡ÍÂ ', '⚠'),          # Warning
            ('ÍÂ¯ÍÂ¸ÍÂ ', '⚠'),         # Warning variant
            ('ÍÂ¢ÍÂÍÂ', '❌'),          # X mark
            ('Â🛒', '🛒'),              # Fix cart emoji
            ('Â½~Â½', '☰'),            # Menu
        ]

        # Apply replacements character by character
        for old, new in replacements:
            text = text.replace(old, new)

        # Write back as UTF-8 (without BOM)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(text)

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

    print('Starting v2 restoration...\n')
    ok = fail = 0

    for fname in files:
        fpath = os.path.join(base, fname)
        if os.path.exists(fpath):
            if fix_corruption(fpath):
                ok += 1
            else:
                fail += 1

    print('\n' + '='*50)
    print('Done: %d OK, %d FAILED' % (ok, fail))
    print('='*50)

if __name__ == '__main__':
    main()
