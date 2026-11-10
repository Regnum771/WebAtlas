"""Builds tiny HEC-RAS-like result files with the real group layout (for checks only)."""
import numpy as np
import h5py

UTM49N = (
    'PROJCS["WGS_1984_UTM_Zone_49N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",'
    'SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],'
    'UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],'
    'PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],'
    'PARAMETER["Central_Meridian",111.0],PARAMETER["Scale_Factor",0.9996],'
    'PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
)
X0, Y0 = 200000.0, 1700000.0  # lower-left corner of area A1
TS = "Results/Unsteady/Output/Output Blocks/Base Output/Unsteady Time Series"


def _geometry(f, name, x0, y0, wse=None):
    """A 2x2 grid of 100 m cells (cell k = row k//2, col k%2, y up) plus one ghost cell."""
    fp = np.array([[x0 + 100 * c, y0 + 100 * r] for r in range(3) for c in range(3)], dtype="f8")
    cells = np.full((5, 5), -1, dtype="i4")
    centres = np.zeros((5, 2), dtype="f8")
    for k in range(4):
        r, c = divmod(k, 2)
        a, b = r * 3 + c, r * 3 + c + 1
        cells[k, :4] = [a, b, b + 3, a + 3]
        centres[k] = [x0 + 100 * c + 50, y0 + 100 * r + 50]
    centres[4] = [x0 - 5000, y0 - 5000]  # ghost cell, no polygon
    g = f.require_group(f"Geometry/2D Flow Areas/{name}")
    g.create_dataset("Cells Center Coordinate", data=centres)
    g.create_dataset("FacePoints Coordinate", data=fp)
    g.create_dataset("Cells FacePoint Indexes", data=cells)
    g.create_dataset("Cells Minimum Elevation", data=np.full(5, 10.0, dtype="f4"))
    if wse is not None:
        f.create_dataset(f"{TS}/2D Flow Areas/{name}/Water Surface", data=wse)


def build(path, results=True, areas=("A1",), wse=None):
    """`wse` is the (9, 5) Water Surface of the first area; default is a flat 10.0."""
    with h5py.File(path, "w") as f:
        f.attrs["File Type"] = "HEC-RAS Results"
        f.attrs["Projection"] = UTM49N
        f.create_dataset("Geometry/2D Flow Areas/Attributes",
                         data=np.array([(a.encode(),) for a in areas], dtype=[("Name", "S16")]))
        f.create_dataset("Geometry/2D Flow Areas/Cell Info",
                         data=np.array([[0, 4]] * len(areas), dtype="i4"))
        for i, a in enumerate(areas):
            w = None
            if results:
                w = (wse if (wse is not None and i == 0) else np.full((9, 5), 10.0)).astype("f4")
            _geometry(f, a, X0 + 1000 * i, Y0, w)
        if results:
            stamps = [f"25OCT2025 {m // 60:02d}:{m % 60:02d}:00".encode() for m in range(0, 135, 15)]
            f.create_dataset(f"{TS}/Time Date Stamp", data=np.array(stamps, dtype="S19"))
