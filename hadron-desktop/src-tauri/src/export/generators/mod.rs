pub mod html;
pub mod html_interactive;
pub mod json;
pub mod markdown;
pub mod txt;
pub mod xlsx;

pub use html::generate_html;
pub use html_interactive::generate_html_interactive;
pub use json::generate_json;
pub use markdown::generate_markdown;
pub use txt::generate_txt;
pub use xlsx::generate_xlsx;
