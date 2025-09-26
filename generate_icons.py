"""
Icon Generator for PWA
Run this script to generate all required icon sizes for your PWA
"""

from PIL import Image, ImageDraw, ImageFont
import os

def create_app_icon(size, output_path):
    """Create a simple app icon with the given size"""
    # Create a new image with gradient background
    img = Image.new('RGB', (size, size), '#007BFF')
    draw = ImageDraw.Draw(img)
    
    # Create a gradient effect
    for i in range(size):
        alpha = int(255 * (1 - i / size))
        color = (0, 123 + int(132 * i / size), 255)
        draw.line([(0, i), (size, i)], fill=color)
    
    # Add a circle
    margin = size // 6
    circle_bbox = [margin, margin, size - margin, size - margin]
    draw.ellipse(circle_bbox, fill='white', outline='#74ebd5', width=size//40)
    
    # Add text/symbol
    try:
        # Try to use a nice font
        font_size = size // 8
        font = ImageFont.truetype("arial.ttf", font_size)
    except:
        # Fallback to default font
        font = ImageFont.load_default()
    
    # Add attendance symbol (A)
    text = "📋"  # Attendance/clipboard emoji
    if size >= 192:  # Only add text for larger icons
        try:
            # For newer Pillow versions
            bbox = draw.textbbox((0, 0), text, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]
        except:
            # For older Pillow versions
            text_width, text_height = draw.textsize(text, font=font)
        
        text_x = (size - text_width) // 2
        text_y = (size - text_height) // 2
        draw.text((text_x, text_y), text, fill='#007BFF', font=font)
    else:
        # For smaller icons, just add a simple geometric shape
        center = size // 2
        radius = size // 6
        draw.ellipse([center - radius, center - radius, 
                     center + radius, center + radius], 
                    fill='#007BFF')
    
    # Save the image
    img.save(output_path, 'PNG', optimize=True)
    print(f"✅ Generated icon: {output_path}")

def generate_all_icons():
    """Generate all required PWA icons"""
    
    # Create static directory if it doesn't exist
    if not os.path.exists('static'):
        os.makedirs('static')
    
    # Icon sizes required for PWA
    icon_sizes = [72, 96, 128, 144, 152, 192, 384, 512]
    
    print("🎨 Generating PWA icons...")
    
    for size in icon_sizes:
        output_path = f'static/icon-{size}.png'
        create_app_icon(size, output_path)
    
    print("\n🎉 All PWA icons generated successfully!")
    print("📱 Your app is now ready to be installed as a PWA!")
    
    # Also create a favicon
    create_app_icon(32, 'static/favicon.png')
    print("✅ Generated favicon: static/favicon.png")

if __name__ == "__main__":
    generate_all_icons()