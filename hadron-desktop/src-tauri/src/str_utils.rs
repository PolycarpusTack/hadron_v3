/// String utility functions.

/// Returns the largest byte index `<= max_byte` that is on a UTF-8 char boundary.
///
/// Equivalent to the nightly `str::floor_char_boundary`. Avoids panics when
/// slicing strings that may contain multi-byte characters (CJK, emoji, accented).
#[inline]
pub fn floor_char_boundary(s: &str, max_byte: usize) -> usize {
    if max_byte >= s.len() {
        return s.len();
    }
    // Walk backwards from max_byte to find a char boundary
    let mut idx = max_byte;
    while idx > 0 && !s.is_char_boundary(idx) {
        idx -= 1;
    }
    idx
}

/// Truncate a string to at most `max_chars` bytes (rounded down to a char boundary),
/// appending "..." if truncated.
#[allow(dead_code)]
pub fn truncate_str(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        s.to_string()
    } else {
        let end = floor_char_boundary(s, max_bytes);
        format!("{}...", &s[..end])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_floor_char_boundary_ascii() {
        let s = "hello world";
        assert_eq!(floor_char_boundary(s, 5), 5);
        assert_eq!(floor_char_boundary(s, 100), s.len());
        assert_eq!(floor_char_boundary(s, 0), 0);
    }

    #[test]
    fn test_floor_char_boundary_multibyte() {
        // é is 2 bytes in UTF-8
        let s = "café";
        assert_eq!(s.len(), 5); // c(1) + a(1) + f(1) + é(2)
        assert_eq!(floor_char_boundary(s, 4), 3); // backs up from middle of é
        assert_eq!(floor_char_boundary(s, 5), 5); // full string
        assert_eq!(floor_char_boundary(s, 3), 3); // before é
    }

    #[test]
    fn test_floor_char_boundary_emoji() {
        // 🦀 is 4 bytes
        let s = "hi🦀!";
        assert_eq!(s.len(), 7); // h(1) + i(1) + 🦀(4) + !(1)
        assert_eq!(floor_char_boundary(s, 3), 2); // backs up from middle of emoji
        assert_eq!(floor_char_boundary(s, 6), 6); // after emoji
    }

    #[test]
    fn test_floor_char_boundary_cjk() {
        // Each CJK char is 3 bytes
        let s = "日本語";
        assert_eq!(s.len(), 9);
        assert_eq!(floor_char_boundary(s, 4), 3); // rounds to end of 日
        assert_eq!(floor_char_boundary(s, 7), 6); // rounds to end of 本
    }

    #[test]
    fn test_truncate_str_no_truncation() {
        assert_eq!(truncate_str("hello", 10), "hello");
    }

    #[test]
    fn test_truncate_str_with_multibyte() {
        let s = "café latte";
        let result = truncate_str(s, 5);
        // Should not panic, should truncate at char boundary
        assert!(result.ends_with("..."));
        assert!(!result.contains("�")); // no replacement chars
    }
}
