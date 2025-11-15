#!/usr/bin/env python3
"""
Test script to verify large file handling
Creates a test crash log of specified size
"""

from pathlib import Path

def create_large_crash_log(size_kb: int, filename: str = "samples/large-crash-test.log"):
    """Create a test crash log of specified size."""

    # Base crash log content
    header = """VisualWorks Smalltalk - Unhandled Exception Report
================================================

Time: 2025-11-12 14:32:15 PST
Image: ProductionApp.im
VM Version: 9.2.1
OS: Windows 10 Pro (Build 19045)

Exception: MessageNotUnderstood
Message: #formatDate:
Receiver: nil

Stack Trace:
------------

"""

    footer = """
Source Code Context:
-------------------
ReportGenerator>>generatePDFReport
  "Generate a PDF report for the specified date range"

  | formattedStart formattedEnd |

  formattedStart := startDate formatDate: format.  "<-- CRASH HERE"
  formattedEnd := endDate formatDate: format.

  ^ self buildReportWith: formattedStart and: formattedEnd

Root Cause: The startDate instance variable is nil.
"""

    # Calculate how much filler we need
    current_size = len(header) + len(footer)
    target_size = size_kb * 1024
    filler_needed = target_size - current_size

    # Create filler content (realistic stack frames)
    filler_lines = []
    frame_num = 1
    while len('\n'.join(filler_lines)) < filler_needed:
        filler_lines.append(f"{frame_num}. SomeClass>>someMethod:with:parameters:")
        filler_lines.append(f"   Context PC: {frame_num * 10}")
        filler_lines.append(f"   Receiver: anObject{frame_num}")
        filler_lines.append(f"   Arguments: arg1, arg2, arg3")
        filler_lines.append("")
        frame_num += 1

    # Combine
    content = header + '\n'.join(filler_lines[:filler_needed//50]) + footer

    # Ensure directory exists
    Path(filename).parent.mkdir(exist_ok=True)

    # Write file
    Path(filename).write_text(content)

    actual_size = len(content) / 1024
    print(f"✅ Created {filename}")
    print(f"   Size: {actual_size:.2f} KB")
    return filename


if __name__ == '__main__':
    import sys

    size = int(sys.argv[1]) if len(sys.argv) > 1 else 500

    print(f"Creating {size} KB test crash log...")
    filename = create_large_crash_log(size)

    print(f"\nTest it with:")
    print(f"  python analyze.py {filename}")
