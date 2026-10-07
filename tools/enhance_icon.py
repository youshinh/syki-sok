import numpy as np
from PIL import Image, ImageFilter

orig = Image.open('app.png')
orig_arr = np.array(orig, dtype=np.float32)
h, w = orig_arr.shape[:2]
alpha = orig_arr[:, :, 3]

# The 4 bars exact parameters: (yc, xs, xe, r)
r = 33.5
pills_spec = [
    (242.0, 237.5, 555.5, r),
    (359.5, 237.5, 374.5, r),
    (476.5, 237.5, 477.5, r),
    (594.0, 237.5, 444.5, r)
]

# Generate distance field and masks for each pill
Y, X = np.ogrid[:h, :w]

def get_pill_geometry(yc, xs, xe, r):
    X_clamped = np.clip(X, xs, xe)
    dist = np.sqrt((X - X_clamped)**2 + (Y - yc)**2)
    # Inside mask: 1.0 inside, smooth transition at boundary
    mask = np.clip((r - dist) + 0.5, 0.0, 1.0)
    # Normalized height profile (dome/cylinder) for 3D lighting: 0 at edge, 1 at center
    norm_dist = np.clip(dist / r, 0.0, 1.0)
    height = np.sqrt(1.0 - norm_dist**2)
    # Normal vectors (nx, ny, nz)
    nx = np.where(dist > 1e-4, (X - X_clamped) / r, 0.0)
    ny = np.where(dist > 1e-4, (Y - yc) / r, 0.0)
    nz = height
    return mask, height, nx, ny, nz, (X - xs) / max(1.0, xe - xs)

# Option 1: Sleek Glossy Obsidian / Silver Glass (High contrast, refined metallic/specular)
def render_style_glossy():
    img = orig_arr.copy()
    
    # Light direction: from top-left, slightly toward viewer
    lx, ly, lz = -0.4, -0.6, 0.7
    lnorm = np.sqrt(lx**2 + ly**2 + lz**2)
    lx, ly, lz = lx/lnorm, ly/lnorm, lz/lnorm
    
    # View direction
    vx, vy, vz = 0.0, 0.0, 1.0
    # Half-vector
    hx, hy, hz = lx + vx, ly + vy, lz + vz
    hnorm = np.sqrt(hx**2 + hy**2 + hz**2)
    hx, hy, hz = hx/hnorm, hy/hnorm, hz/hnorm

    for idx, (yc, xs, xe, r_val) in enumerate(pills_spec):
        mask, height, nx, ny, nz, u = get_pill_geometry(yc, xs, xe, r_val)
        
        # Diffuse component
        diffuse = np.maximum(0.0, nx*lx + ny*ly + nz*lz)
        
        # Specular gloss (sharp high-end sheen)
        ndoth = np.maximum(0.0, nx*hx + ny*hy + nz*hz)
        specular = ndoth**32
        specular_broad = ndoth**8
        
        # Upper edge rim highlight
        upper_rim = np.clip((-ny * 0.8 + 0.2), 0.0, 1.0) * np.clip((1.0 - np.abs(nz)) * 2.0, 0.0, 1.0)
        
        # Pill base surface: deep refined dark platinum / dark sapphire glass
        # Base luminance: 40 to 80 (clearly visible contrast against background 18!)
        base_lum = 55.0 + 35.0 * diffuse + 25.0 * (1.0 - (Y - (yc - r_val))/(2*r_val))
        
        # Add diagonal glossy sweep across pill (curved glass reflection)
        diag = (X * 0.7 + Y * 0.7)
        sweep = np.exp(-((diag - (xs + yc)*0.7)**2) / (60**2)) * 60.0
        
        # Combine lighting
        lum = base_lum + 140.0 * specular + 50.0 * specular_broad + 90.0 * upper_rim + sweep
        lum = np.clip(lum, 0.0, 255.0)
        
        # Color tint: crisp neutral silver with subtle cool tint (RGB: lum*0.96, lum*0.98, lum*1.02)
        r_col = np.clip(lum * 0.96, 0, 255)
        g_col = np.clip(lum * 0.98, 0, 255)
        b_col = np.clip(lum * 1.02, 0, 255)
        
        # Outer bevel glow / rim outline
        bevel_mask = np.clip((r_val + 4.0 - np.sqrt((X - np.clip(X, xs, xe))**2 + (Y - yc)**2)) + 0.5, 0.0, 1.0) - mask
        bevel_col = 60.0 + 80.0 * np.maximum(0.0, -ny) # Top of bevel catches light
        
        for c, col in enumerate([r_col, g_col, b_col]):
            # Blend pill into image
            img[:, :, c] = img[:, :, c] * (1.0 - mask) + col * mask
            # Blend subtle bevel
            img[:, :, c] = np.maximum(img[:, :, c], bevel_col * bevel_mask * 0.7)
            
    img[:, :, 3] = alpha
    return np.clip(img, 0, 255).astype(np.uint8)

# Option 2: Vibrant Glossy Platinum (Brighter, maximum clarity at small sizes like taskbar 16px/32px)
def render_style_vibrant():
    img = orig_arr.copy()
    
    lx, ly, lz = -0.3, -0.7, 0.65
    lnorm = np.sqrt(lx**2 + ly**2 + lz**2)
    lx, ly, lz = lx/lnorm, ly/lnorm, lz/lnorm
    
    hx, hy, hz = lx, ly, lz + 1.0
    hnorm = np.sqrt(hx**2 + hy**2 + hz**2)
    hx, hy, hz = hx/hnorm, hy/hnorm, hz/hnorm

    for idx, (yc, xs, xe, r_val) in enumerate(pills_spec):
        mask, height, nx, ny, nz, u = get_pill_geometry(yc, xs, xe, r_val)
        
        diffuse = np.maximum(0.0, nx*lx + ny*ly + nz*lz)
        ndoth = np.maximum(0.0, nx*hx + ny*hy + nz*hz)
        specular = ndoth**24
        
        # Top-down gradient on the pill surface (like Apple Liquid Metal / Ceramic)
        # Top is luminous silver (180-220), bottom is rich gunmetal (70-90)
        grad_y = (Y - (yc - r_val)) / (2.0 * r_val)
        pill_body = 180.0 - 100.0 * np.clip(grad_y, 0.0, 1.0)
        
        # Crisp glossy line reflection along the top half
        sheen_line = np.exp(-((Y - (yc - r_val*0.45))**2) / (7.0**2)) * 75.0
        
        lum = pill_body + 90.0 * specular + sheen_line
        lum = np.clip(lum, 0.0, 255.0)
        
        r_col = np.clip(lum * 0.97, 0, 255)
        g_col = np.clip(lum * 0.98, 0, 255)
        b_col = np.clip(lum * 1.00, 0, 255)
        
        # Outer rim bevel
        bevel_mask = np.clip((r_val + 3.0 - np.sqrt((X - np.clip(X, xs, xe))**2 + (Y - yc)**2)) + 0.5, 0.0, 1.0) - mask
        bevel_col = 50.0 + 90.0 * np.maximum(0.0, -ny)
        
        for c, col in enumerate([r_col, g_col, b_col]):
            img[:, :, c] = img[:, :, c] * (1.0 - mask) + col * mask
            img[:, :, c] = np.maximum(img[:, :, c], bevel_col * bevel_mask * 0.6)
            
    img[:, :, 3] = alpha
    return np.clip(img, 0, 255).astype(np.uint8)

# Option 3: Elegant Dark Olive / Emerald Luster (Matches syki dark-olive theme)
def render_style_olive():
    img = orig_arr.copy()
    
    lx, ly, lz = -0.35, -0.65, 0.67
    lnorm = np.sqrt(lx**2 + ly**2 + lz**2)
    lx, ly, lz = lx/lnorm, ly/lnorm, lz/lnorm
    
    hx, hy, hz = lx, ly, lz + 1.0
    hnorm = np.sqrt(hx**2 + hy**2 + hz**2)
    hx, hy, hz = hx/hnorm, hy/hnorm, hz/hnorm

    for idx, (yc, xs, xe, r_val) in enumerate(pills_spec):
        mask, height, nx, ny, nz, u = get_pill_geometry(yc, xs, xe, r_val)
        
        diffuse = np.maximum(0.0, nx*lx + ny*ly + nz*lz)
        ndoth = np.maximum(0.0, nx*hx + ny*hy + nz*hz)
        specular = ndoth**28
        
        grad_y = (Y - (yc - r_val)) / (2.0 * r_val)
        pill_body = 140.0 - 75.0 * np.clip(grad_y, 0.0, 1.0)
        sheen_line = np.exp(-((Y - (yc - r_val*0.4))**2) / (8.0**2)) * 65.0
        
        lum = pill_body + 110.0 * specular + sheen_line
        lum = np.clip(lum, 0.0, 255.0)
        
        # Subtle elegant sage/olive tint: R=0.88, G=0.98, B=0.82
        r_col = np.clip(lum * 0.88, 0, 255)
        g_col = np.clip(lum * 0.98, 0, 255)
        b_col = np.clip(lum * 0.82, 0, 255)
        
        bevel_mask = np.clip((r_val + 3.0 - np.sqrt((X - np.clip(X, xs, xe))**2 + (Y - yc)**2)) + 0.5, 0.0, 1.0) - mask
        bevel_col = 50.0 + 80.0 * np.maximum(0.0, -ny)
        
        for c, col in enumerate([r_col, g_col, b_col]):
            img[:, :, c] = img[:, :, c] * (1.0 - mask) + col * mask
            img[:, :, c] = np.maximum(img[:, :, c], bevel_col * bevel_mask * 0.6)
            
    img[:, :, 3] = alpha
    return np.clip(img, 0, 255).astype(np.uint8)

Image.fromarray(render_style_glossy()).save('preview_icon1_glossy_silver.png')
Image.fromarray(render_style_vibrant()).save('preview_icon2_vibrant_platinum.png')
Image.fromarray(render_style_olive()).save('preview_icon3_elegant_olive.png')
print("Rendered 3 styles successfully!")
