import fs from "fs";

// Purpose: Deletes local files from the filesystem
const fileDeleteFromCloud = (localfilepath) => {
  const paths = Array.isArray(localfilepath)
    ? localfilepath.map((f) => f.path)
    : Object.values(localfilepath)
        .flat()
        .map((f) => f.path);

  paths.forEach((path) => {
    fs.unlinkSync(path);
  });
};

export { fileDeleteFromCloud };
