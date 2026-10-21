"""Bounded, deterministic clustering of normalized CAM++ speaker embeddings."""
import numpy as np
from sklearn.cluster import AgglomerativeClustering, KMeans
from funasr.models.campplus.cluster_backend import SpectralCluster, ClusterBackend


class _DeterministicSpectral(SpectralCluster):
    def cluster_embs(self, embeddings, count):
        return KMeans(n_clusters=count, n_init=10, random_state=0).fit_predict(embeddings)


def cluster_speakers(vectors, speaker_count=None):
    # Keep the quadratic affinity matrix bounded for long recordings.
    selected = np.unique(np.linspace(0, len(vectors) - 1, min(len(vectors), 800)).astype(int))
    representatives = vectors[selected]
    count = min(speaker_count, len(selected)) if speaker_count else None
    if len(selected) == 1 or count == 1:
        return np.zeros(len(vectors), dtype=int)

    if count is None and len(selected) < 20:
        # A nearest-neighbour graph is poorly resolved with just a few windows.
        # Preserve the calibrated distance cutoff for short/single-speaker clips.
        clusters = AgglomerativeClustering(
            n_clusters=None, distance_threshold=.6, metric='cosine', linkage='average'
        ).fit_predict(representatives)
        if len(set(clusters)) > 8:
            clusters = _DeterministicSpectral(max_num_spks=8)(representatives, 8)
    else:
        # Average-linkage forced to k leaves rare outliers as clusters and can
        # merge both real voices. Spectral clustering uses local voice affinity.
        clusters = _DeterministicSpectral(max_num_spks=min(8, len(selected) - 1))(
            representatives, count
        )
        if count is None:
            clusters = ClusterBackend().merge_by_cos(clusters, representatives, .78)

    centers = np.stack([representatives[clusters == i].mean(axis=0) for i in sorted(set(clusters))])
    centers /= np.maximum(np.linalg.norm(centers, axis=1, keepdims=True), 1e-10)
    return (vectors @ centers.T).argmax(axis=1)
