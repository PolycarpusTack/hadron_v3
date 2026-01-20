use crate::models::CrashFile;
use crate::patterns::matchers::check_string_matcher;
use crate::patterns::pattern::{ContextMatcher, SizeCondition};

/// Check if context matches all conditions
pub fn matches_context(crash: &CrashFile, matcher: &ContextMatcher) -> bool {
    let context = match &crash.context {
        Some(ctx) => ctx,
        None => return false,
    };

    // Check receiver class
    if let Some(ref class_matcher) = matcher.receiver_class {
        let matches = context
            .receiver
            .as_ref()
            .map(|r| check_string_matcher(class_matcher, &r.class_name))
            .unwrap_or(false);
        if !matches {
            return false;
        }
    }

    // Check if receiver is collection
    if let Some(should_be_collection) = matcher.receiver_is_collection {
        let is_collection = context
            .receiver
            .as_ref()
            .map(|r| r.is_collection)
            .unwrap_or(false);
        if is_collection != should_be_collection {
            return false;
        }
    }

    // Check collection size
    if let Some(ref size_cond) = matcher.collection_size {
        let size = context.receiver.as_ref().and_then(|r| r.collection_size);

        let matches = match (size, size_cond) {
            (Some(s), SizeCondition::Equals(n)) => s == *n,
            (Some(s), SizeCondition::LessThan(n)) => s < *n,
            (Some(s), SizeCondition::GreaterThan(n)) => s > *n,
            (Some(s), SizeCondition::Empty) => s == 0,
            (Some(s), SizeCondition::NotEmpty) => s > 0,
            (None, _) => false,
        };

        if !matches {
            return false;
        }
    }

    // Check for required business objects
    if !matcher.has_business_objects.is_empty() {
        let has_all = matcher.has_business_objects.iter().all(|required| {
            context
                .business_objects
                .iter()
                .any(|obj| obj.class_name.contains(required))
        });
        if !has_all {
            return false;
        }
    }

    true
}

/// Extract collection size mismatch info
pub fn get_collection_mismatch(crash: &CrashFile) -> Option<(usize, usize)> {
    let context = crash.context.as_ref()?;
    let receiver = context.receiver.as_ref()?;

    if !receiver.is_collection {
        return None;
    }

    let size = receiver.collection_size?;
    let requested_index = crash
        .exception
        .parameter
        .as_ref()
        .and_then(|p| p.parse::<usize>().ok())?;

    if requested_index > size {
        Some((size, requested_index))
    } else {
        None
    }
}
