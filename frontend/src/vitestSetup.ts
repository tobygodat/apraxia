import { configure } from "@testing-library/react";

// The default 1000ms async timeout for findBy*/waitFor intermittently trips
// under full-suite load (e.g. MainWorkspace.test.tsx's cold lazy route
// import). Give async utilities more headroom across the whole suite.
configure({ asyncUtilTimeout: 3000 });
