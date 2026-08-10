use std::{env, fs::File, io::BufWriter, path::PathBuf};

use ico::{IconDir, IconDirEntry, ResourceType};

fn main() {
    let mut arguments = env::args_os().skip(1);
    let input = arguments
        .next()
        .map(PathBuf::from)
        .expect("input ICO path is required");
    let output = arguments
        .next()
        .map(PathBuf::from)
        .expect("output ICO path is required");
    assert!(arguments.next().is_none(), "unexpected extra arguments");

    let source = IconDir::read(File::open(&input).expect("input ICO should open"))
        .expect("input ICO should decode");
    let mut compatible = IconDir::new(ResourceType::Icon);
    for entry in source.entries() {
        let image = entry.decode().expect("ICO frame should decode");
        compatible.add_entry(
            IconDirEntry::encode_as_bmp(&image).expect("ICO frame should encode as bitmap"),
        );
    }
    assert!(
        !compatible.entries().is_empty(),
        "input ICO should contain frames"
    );

    let temporary = output.with_extension("ico.tmp");
    compatible
        .write(BufWriter::new(
            File::create(&temporary).expect("temporary ICO should be created"),
        ))
        .expect("compatible ICO should be written");
    std::fs::rename(&temporary, &output).expect("compatible ICO should replace generated ICO");
}
