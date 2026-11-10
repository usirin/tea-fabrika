// The brain's generated tables (`virtual:fabrika-built`), which libfabrika's build writes.
// A side-effect import of libfabrika's `./build-modules` export brings that global declaration
// file into this program. This file holds no other declaration, so turning it into a module
// changes nothing else it means.
import "@kampus/libfabrika/build-modules";
