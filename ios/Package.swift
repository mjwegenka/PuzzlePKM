// swift-tools-version: 5.9
// PuzzlePKM Mobile – Swift Package manifest.
//
// This package contains all Swift source code for the PuzzlePKM iOS companion
// app. To build and run the app, open this directory in Xcode 15+ and create
// an iOS App target that imports the PuzzlePKMMobile library (see ios/README.md
// for step-by-step setup instructions).

import PackageDescription

let package = Package(
    name: "PuzzlePKMMobile",
    platforms: [
        .iOS(.v17),
    ],
    products: [
        .library(
            name: "PuzzlePKMMobile",
            targets: ["PuzzlePKMMobile"]
        ),
    ],
    dependencies: [
        // Official Dropbox Swift SDK – used for OAuth and file upload/download.
        .package(
            url: "https://github.com/dropbox/SwiftyDropbox.git",
            from: "9.1.0"
        ),
    ],
    targets: [
        .target(
            name: "PuzzlePKMMobile",
            dependencies: [
                .product(name: "SwiftyDropbox", package: "SwiftyDropbox"),
            ],
            path: "Sources/PuzzlePKMMobile"
        ),
    ]
)
