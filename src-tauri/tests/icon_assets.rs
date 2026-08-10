use std::{fs::File, path::PathBuf};

#[test]
fn windows_icon_is_transparent_and_uses_the_canvas() {
    let icon_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons/icon.ico");
    let directory = ico::IconDir::read(File::open(icon_path).expect("Windows icon should exist"))
        .expect("Windows icon should decode");

    assert!(
        !directory.entries().is_empty(),
        "Windows icon has no frames"
    );
    for entry in directory.entries() {
        assert!(
            !entry.is_png(),
            "Windows executable icon frames must use bitmap encoding so alpha survives resource embedding"
        );
        let image = entry.decode().expect("Windows icon frame should decode");
        let width = image.width() as usize;
        let height = image.height() as usize;
        let rgba = image.rgba_data();
        let alpha_at = |x: usize, y: usize| rgba[(y * width + x) * 4 + 3];

        for (x, y) in [
            (0, 0),
            (width - 1, 0),
            (0, height - 1),
            (width - 1, height - 1),
        ] {
            assert_eq!(
                alpha_at(x, y),
                0,
                "{}x{} icon frame has an opaque corner",
                width,
                height
            );
        }

        let mut min_x = width;
        let mut max_x = 0;
        for y in 0..height {
            for x in 0..width {
                if alpha_at(x, y) > 8 {
                    min_x = min_x.min(x);
                    max_x = max_x.max(x);
                }
            }
        }
        assert!(min_x <= max_x, "{}x{} icon frame is empty", width, height);
        let coverage = (max_x - min_x + 1) as f64 / width as f64;
        assert!(
            (0.80..=0.94).contains(&coverage),
            "{}x{} icon frame uses {:.1}% of its canvas",
            width,
            height,
            coverage * 100.0
        );
    }
}
