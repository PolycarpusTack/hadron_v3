from PIL import Image
import io

# Create a simple 32x32 icon
img = Image.new('RGBA', (32, 32), color=(59, 130, 246, 255))  # Blue color

# Save as ICO
img.save('icon.ico', format='ICO', sizes=[(32, 32)])
print("Icon created successfully!")
