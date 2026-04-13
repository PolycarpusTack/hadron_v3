use super::types::{DerivedMetrics, PerformanceHeader};

/// Compute derived metrics from a parsed performance header.
pub fn compute_derived(header: &PerformanceHeader) -> DerivedMetrics {
    let total_time = header.active_time + header.other_processes;

    // cpu_utilization = (active + other) / max(real, active+other) * 100
    let cpu_utilization = if total_time > 0.0 {
        (total_time / header.real_time.max(total_time)) * 100.0
    } else {
        0.0
    };

    // activity_ratio = active / real * 100
    let activity_ratio = if header.real_time > 0.0 {
        (header.active_time / header.real_time) * 100.0
    } else {
        0.0
    };

    // sample_density = samples / active
    let sample_density = if header.active_time > 0.0 {
        header.samples as f64 / header.active_time
    } else {
        0.0
    };

    // gc_pressure = (scavenges + inc_gcs) / samples
    let gc_pressure = if header.samples > 0 {
        (header.scavenges + header.inc_gcs) as f64 / header.samples as f64
    } else {
        0.0
    };

    DerivedMetrics {
        cpu_utilization: (cpu_utilization * 10.0).round() / 10.0,
        activity_ratio: (activity_ratio * 10.0).round() / 10.0,
        sample_density: (sample_density * 10.0).round() / 10.0,
        gc_pressure: (gc_pressure * 100.0).round() / 100.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::performance::types::PerformanceHeader;

    fn sample_header() -> PerformanceHeader {
        PerformanceHeader {
            samples: 1500,
            avg_ms_per_sample: 2.5,
            scavenges: 3000,
            inc_gcs: 50,
            stack_spills: 2,
            mark_stack_overflows: 0,
            weak_list_overflows: 0,
            jit_cache_spills: 1,
            active_time: 3.75,
            other_processes: 0.5,
            real_time: 5.0,
            profiling_overhead: 0.1,
        }
    }

    #[test]
    fn test_derived_metrics() {
        let header = sample_header();
        let derived = compute_derived(&header);

        // cpu_utilization = (3.75 + 0.5) / max(5.0, 4.25) * 100 = 4.25/5.0 * 100 = 85.0
        assert_eq!(derived.cpu_utilization, 85.0);

        // activity_ratio = 3.75 / 5.0 * 100 = 75.0
        assert_eq!(derived.activity_ratio, 75.0);

        // sample_density = 1500 / 3.75 = 400.0
        assert_eq!(derived.sample_density, 400.0);

        // gc_pressure = (3000 + 50) / 1500 = 3050/1500 ≈ 2.03
        assert!((derived.gc_pressure - 2.03).abs() < 0.01);
    }

    #[test]
    fn test_derived_metrics_zero_time() {
        let header = PerformanceHeader {
            samples: 0,
            active_time: 0.0,
            real_time: 0.0,
            other_processes: 0.0,
            ..Default::default()
        };
        let derived = compute_derived(&header);

        // No panics — all should return 0.0
        assert_eq!(derived.cpu_utilization, 0.0);
        assert_eq!(derived.activity_ratio, 0.0);
        assert_eq!(derived.sample_density, 0.0);
        assert_eq!(derived.gc_pressure, 0.0);
    }
}
