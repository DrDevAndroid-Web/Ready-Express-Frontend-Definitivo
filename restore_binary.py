#!/usr/bin/env python3
"""Binary-level UTF-8 restoration using hex pattern matching."""

import os

def restore_file_binary(filepath):
    """Restore UTF-8 corruption at the binary level."""
    try:
        with open(filepath, 'rb') as f:
            data = bytearray(f.read())

        # Remove UTF-8 BOM if present
        if data.startswith(b'\xef\xbb\xbf'):
            data = data[3:]

        # Hex patterns for common corruptions
        # Format: (corrupted_hex_bytes, correct_utf8_bytes)
        replacements = [
            # Emojis (hex patterns of double-encoded sequences)
            (b'\xc3\xb0\xc3\x85\xc2\xb8\xc3\x82\xc2\xb1', b'\xf0\x9f\xa5\xa1'),  # 🥡
            (b'\xc3\xb0\xc2\xb8\xc3\x85\xc2\xb8', b'\xf0\x9f\xa5\xa1'),  # variant
            (b'\xc3\xb0\xc2\xb0\xc3\x85\xc2\xb8', b'\xf0\x9f\x85\xbe'),  # variant
            (b'\xc3\xb0\xc2\xb8', b'\xf0\x9f'),  # emoji prefix fix

            # Spanish characters (2-byte UTF-8 corrupted)
            (b'Env\xc3\xado', 'Envía'.encode('utf-8')),
            (b'Guant\xc3\xa1namo', 'Guantánamo'.encode('utf-8')),
            (b'\xc2\xbf\xc3\x89', '¿É'.encode('utf-8')),
            (b'C\xc3\xb3mo', 'Cómo'.encode('utf-8')),
            (b'Men\xc3\xba', 'Menú'.encode('utf-8')),
            (b'tel\xc3\xa9fono', 'teléfono'.encode('utf-8')),
            (b'direcci\xc3\xb3n', 'dirección'.encode('utf-8')),
            (b'validaci\xc3\xb3n', 'validación'.encode('utf-8')),
            (b'v\xc3\xa1lido', 'válido'.encode('utf-8')),
            (b'Env\xc3\xado', 'Envío'.encode('utf-8')),
            (b'pol\xc3\xadtica', 'política'.encode('utf-8')),
            (b't\xc3\xa9rminos', 'términos'.encode('utf-8')),
        ]

        for corrupted, correct in replacements:
            data = data.replace(corrupted, correct)

        # Now do text-level replacements for remaining issues
        text = data.decode('utf-8', errors='replace')

        # Fix remaining mojibake
        text_fixes = [
            ('Í¿CÍÂ³mo', '¿Cómo'),
            ('QuÍÂ­enes', 'Quiénes'),
            ('telÍÂ©fono', 'teléfono'),
            ('dirección', 'dirección'),
            ('ÍÂ½"?ÍÂ½"?', '──'),
            ('Â½~Â½', '☰'),
            ('Â🛒', '🛒'),
            ('ÍÂ°ÍÂ¸ÍÂÍÂ±', '🥡'),
        ]

        for old, new in text_fixes:
            text = text.replace(old, new)

        # Write back
        with open(filepath, 'wb') as f:
            f.write(text.encode('utf-8'))

        print('OK: ' + os.path.basename(filepath))
        return True
    except Exception as e:
        print('ERR: ' + os.path.basename(filepath) + ' - ' + str(e))
        return False

base = r'c:\Users\100270999\Documents\PRPOGRAMACION\ReadyExpressNow\frontend'
files = [
    'index.html', 'pago.html', 'ayuda.html', 'quienes-somos.html',
    'terminos.html', 'politica-privacidad.html',
    'js/products.js', 'js/payment.js', 'js/cart.js', 'js/checkout.js', 'js/api.js',
]

print('Binary restoration...\n')
ok = fail = 0
for fname in files:
    fpath = os.path.join(base, fname)
    if os.path.exists(fpath):
        if restore_file_binary(fpath):
            ok += 1
        else:
            fail += 1

print(f'\n{"="*50}\nDone: {ok} OK, {fail} FAILED\n{"="*50}')
