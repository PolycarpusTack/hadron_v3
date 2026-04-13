use std::collections::HashMap;
use std::sync::OnceLock;
use super::types::CustomerIndices;

pub const DEFAULT_KB_INDEX: &str = "won-kb-base";
pub const DEFAULT_RN_INDEX: &str = "base-release-notes";

fn customer_map() -> &'static HashMap<String, &'static str> {
    static MAP: OnceLock<HashMap<String, &'static str>> = OnceLock::new();
    MAP.get_or_init(|| {
        let entries: Vec<(&str, &str)> = vec![
            ("aetn", "aetn-release-notes"),
            ("aeus", "aeus-release-notes"),
            ("ajl", "ajl-release-notes"),
            ("ajmn", "ajmn-release-notes"),
            ("altice", "altice-release-notes"),
            ("amcn", "amcn-release-notes"),
            ("bbc", "bbc-release-notes"),
            ("br", "br-release-notes"),
            ("bsf", "bsf-release-notes"),
            ("bsq", "bsq-release-notes"),
            ("bts", "bts-release-notes"),
            ("bx1", "bx1-release-notes"),
            ("cbc", "cbc-release-notes"),
            ("curi", "curi-release-notes"),
            ("dazn", "dazn-release-notes"),
            ("disco", "disco-release-notes"),
            ("disney plus", "disney-release-notes"),
            ("dmc", "dmc-release-notes"),
            ("dpg", "dpg-release-notes"),
            ("dr", "dr-release-notes"),
            ("dreamwall", "dreamwall-release-notes"),
            ("emgbe", "emgbe-release-notes"),
            ("foxtel", "foxtel-release-notes"),
            ("france televisions", "france-televisions-release-notes"),
            ("m6", "m6-release-notes"),
            ("mbc", "mbc-release-notes"),
            ("mediacorp", "mediacorp-release-notes"),
            ("mediaset", "mediaset-release-notes"),
            ("nep", "nep-release-notes"),
            ("npo", "npo-release-notes"),
            ("nrk", "nrk-release-notes"),
            ("ocs", "ocs-release-notes"),
            ("outernet", "outernet-release-notes"),
            ("pmh", "pmh-release-notes"),
            ("rte", "rte-release-notes"),
            ("rtl hungary", "rtl-hungary-release-notes"),
            ("sh", "sh-release-notes"),
            ("srf", "srf-release-notes"),
            ("swr", "swr-release-notes"),
            ("syn", "syn-release-notes"),
            ("tern", "tern-release-notes"),
            ("tf1", "tf1-release-notes"),
            ("tvmedia", "tvmedia-release-notes"),
            ("tvuv", "tvuv-release-notes"),
            ("twcla", "twcla-release-notes"),
            ("uktv", "uktv-release-notes"),
            ("virgin", "virgin-release-notes"),
            ("vpro", "vpro-release-notes"),
            ("vrt", "vrt-release-notes"),
            ("yes", "yes-release-notes"),
            ("yle", "yle-release-notes"),
        ];
        entries.into_iter().map(|(k, v)| (k.to_string(), v)).collect()
    })
}

pub fn get_customer_indices(customer: &str) -> Option<CustomerIndices> {
    let key = customer.to_lowercase();
    customer_map().get(&key).map(|rn_index| CustomerIndices {
        kb_index: format!("won-kb-{}", key.replace(' ', "-")),
        rn_index: Some(rn_index.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_customer_returns_indices() {
        let result = get_customer_indices("bbc").unwrap();
        assert_eq!(result.kb_index, "won-kb-bbc");
        assert_eq!(result.rn_index.as_deref(), Some("bbc-release-notes"));
    }

    #[test]
    fn known_customer_case_insensitive() {
        let result = get_customer_indices("BBC").unwrap();
        assert_eq!(result.kb_index, "won-kb-bbc");
        assert_eq!(result.rn_index.as_deref(), Some("bbc-release-notes"));
    }

    #[test]
    fn customer_with_space_returns_correct_kb_index() {
        let result = get_customer_indices("disney plus").unwrap();
        assert_eq!(result.kb_index, "won-kb-disney-plus");
        assert_eq!(result.rn_index.as_deref(), Some("disney-release-notes"));
    }

    #[test]
    fn unknown_customer_returns_none() {
        let result = get_customer_indices("nonexistent_customer_xyz");
        assert!(result.is_none());
    }

    #[test]
    fn all_51_customers_are_mapped() {
        let known = [
            "aetn", "aeus", "ajl", "ajmn", "altice", "amcn", "bbc", "br", "bsf", "bsq",
            "bts", "bx1", "cbc", "curi", "dazn", "disco", "disney plus", "dmc", "dpg", "dr",
            "dreamwall", "emgbe", "foxtel", "france televisions", "m6", "mbc", "mediacorp",
            "mediaset", "nep", "npo", "nrk", "ocs", "outernet", "pmh", "rte", "rtl hungary",
            "sh", "srf", "swr", "syn", "tern", "tf1", "tvmedia", "tvuv", "twcla", "uktv",
            "virgin", "vpro", "vrt", "yes", "yle",
        ];
        for customer in &known {
            assert!(
                get_customer_indices(customer).is_some(),
                "Expected mapping for customer: {}",
                customer
            );
        }
        assert_eq!(known.len(), 51);
    }
}
