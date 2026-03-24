# Container Security Scanning Lab

## Overview

This hands-on lab teaches you how to integrate container security scanning into a CI/CD pipeline using **Trivy**, an open-source vulnerability scanner. You will experience a real-world workflow where a pipeline fails due to vulnerabilities in a Docker image, then fix the issue by switching to a hardened Dockerfile and watch the pipeline pass and deploy your application to Amazon EKS.

By the end of this lab, you will understand:

- Why container images contain vulnerabilities and how to detect them
- How to read and interpret a Trivy vulnerability report
- The difference between a vulnerable and a secure Dockerfile
- How to enforce security gates in a GitHub Actions CI/CD pipeline
- How to deploy a scanned, secure container to Kubernetes on AWS EKS

---

## What Gets Created

| Resource | Description |
|----------|-------------|
| GitHub Actions workflow | Automated pipeline that scans images with Trivy before deploying |
| Express.js application | Simple Node.js API with health, products, and metrics endpoints |
| Vulnerable Dockerfile | Intentionally insecure image using `node:14`, running as root |
| Secure Dockerfile | Hardened image using `node:18-alpine`, non-root user, health check |
| Kubernetes manifests | Namespace, Deployment (2 replicas), LoadBalancer Service, ServiceMonitor |
| Trivy policy | Security policy that fails the pipeline on HIGH/CRITICAL CVEs |

---

## Prerequisites

Before starting this lab, make sure you have the following:

1. **EKS cluster running** — The `migration-eks-cluster` in `us-east-1` should already be provisioned from the [cloud-migration-infra](https://github.com/anmutetech/cloud-migration-infra) lab.
2. **DockerHub account** — Sign up at [https://hub.docker.com](https://hub.docker.com) if you do not have one.
3. **kubectl configured** — Your local `kubectl` should be pointed at the EKS cluster:
   ```bash
   aws eks update-kubeconfig --name migration-eks-cluster --region us-east-1
   ```
4. **AWS CLI** — Installed and configured with credentials that have EKS access.
5. **Git** — Installed locally.
6. **GitHub account** — You will fork this repo and configure secrets.

---

## Lab Steps

### Step 1: Fork and Clone the Repository

1. Go to this repository on GitHub and click **Fork** to create your own copy.
2. Clone your fork locally:
   ```bash
   git clone https://github.com/<your-github-username>/container-security-lab.git
   cd container-security-lab
   ```

---

### Step 2: Explore the Dockerfiles

Before running anything, take a few minutes to compare the two Dockerfiles. Understanding the differences is the core learning objective.

#### The Vulnerable Dockerfile (`docker/Dockerfile.vulnerable`)

Open the file and note these problems:

```dockerfile
FROM node:14        # Old base image — Node 14 is end-of-life and contains hundreds of known CVEs
WORKDIR /app
COPY . .            # Copies everything, including files that should not be in the image
RUN npm install     # Installs all dependencies, including devDependencies
EXPOSE 3000
CMD ["node", "server.js"]
```

**What makes it insecure:**

- **Outdated base image (`node:14`):** End-of-life images no longer receive security patches. Trivy will report many CRITICAL and HIGH vulnerabilities in the OS packages and libraries bundled in this image.
- **Runs as root:** The container process runs as the root user by default. If an attacker gains code execution inside the container, they have root privileges.
- **No health check:** Kubernetes (or Docker) cannot determine if the application inside the container is actually healthy.
- **Copies unnecessary files:** The `COPY . .` command may include secrets, documentation, and other files that bloat the image and increase the attack surface.

#### The Secure Dockerfile (`docker/Dockerfile.secure`)

```dockerfile
FROM node:18-alpine                     # Minimal base image — Alpine has far fewer packages and CVEs
RUN addgroup -S appgroup && adduser -S appuser -G appgroup   # Non-root user
WORKDIR /app
COPY app/package.json .
RUN npm install --only=production && npm cache clean --force  # Production deps only
COPY app/server.js .
RUN chown -R appuser:appgroup /app
USER appuser                            # Run as non-root
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
CMD ["node", "server.js"]
```

**What makes it secure:**

- **Alpine-based image:** Contains only essential packages, dramatically reducing the number of potential vulnerabilities.
- **Non-root user:** Even if an attacker exploits the application, they cannot escalate to root inside the container.
- **Health check:** The orchestrator can detect and restart unhealthy containers automatically.
- **Minimal file copy:** Only the files needed to run the application are included.
- **Production dependencies only:** Dev dependencies are excluded, reducing the attack surface further.

---

### Step 3: Configure GitHub Secrets

Your CI/CD pipeline needs credentials to push Docker images and deploy to EKS. In your forked repository on GitHub:

1. Go to **Settings** > **Secrets and variables** > **Actions**
2. Click **New repository secret** and add each of the following:

| Secret Name | Value |
|---|---|
| `DOCKER_USERNAME` | Your DockerHub username |
| `DOCKER_PASSWORD` | Your DockerHub password or access token |
| `AWS_ACCESS_KEY_ID` | Your AWS access key ID |
| `AWS_SECRET_ACCESS_KEY` | Your AWS secret access key |

> **Tip:** For DockerHub, it is recommended to create an Access Token at [https://hub.docker.com/settings/security](https://hub.docker.com/settings/security) instead of using your password.

---

### Step 4: Update the Deployment Manifest

Open `kubernetes/deployment.yaml` and replace the placeholder image name with your DockerHub username:

```yaml
# Change this line:
image: <your-dockerhub-username>/secure-app:latest

# To this (example):
image: johndoe/secure-app:latest
```

Commit the change:

```bash
git add kubernetes/deployment.yaml
git commit -m "Update deployment image to my DockerHub username"
```

---

### Step 5: Push to Trigger the Pipeline (It Will Fail)

Push your changes to the `main` branch:

```bash
git push origin main
```

Now go to your repository on GitHub and click the **Actions** tab. You will see the **Container Security Scan & Deploy** workflow running.

**The pipeline will FAIL at the "Security Scan" job.** This is expected. The default `app/Dockerfile` uses the full `node:18` image, which contains many OS-level packages with known vulnerabilities. Trivy will detect HIGH and CRITICAL CVEs and exit with code 1, causing the job to fail.

---

### Step 6: Review the Trivy Scan Results

Click on the failed workflow run, then click the **Security Scan** job, and expand the **Run Trivy vulnerability scanner** step.

You will see a table like this in the logs:

```
┌──────────────────┬────────────────┬──────────┬────────────────────┬───────────────┬──────────────────────────────────────┐
│     Library      │ Vulnerability  │ Severity │ Installed Version  │ Fixed Version │               Title                  │
├──────────────────┼────────────────┼──────────┼────────────────────┼───────────────┼──────────────────────────────────────┤
│ libssl3          │ CVE-2024-XXXXX │ CRITICAL │ 3.0.9-1            │ 3.0.13-1      │ openssl: some critical vulnerability │
│ zlib1g           │ CVE-2023-XXXXX │ HIGH     │ 1:1.2.13-1         │ 1:1.2.13-2    │ zlib: buffer over-read               │
└──────────────────┴────────────────┴──────────┴────────────────────┴───────────────┴──────────────────────────────────────┘
```

**How to read the table:**

- **Library**: The OS package or library where the vulnerability was found.
- **Vulnerability**: The CVE identifier. You can search for this on [https://nvd.nist.gov](https://nvd.nist.gov) for full details.
- **Severity**: CRITICAL, HIGH, MEDIUM, or LOW. Our policy fails the pipeline on CRITICAL and HIGH.
- **Installed Version**: The version currently in the image.
- **Fixed Version**: The version that patches the vulnerability. If empty, no fix is available yet.
- **Title**: A brief description of the vulnerability.

The key takeaway: the full `node:18` Debian-based image ships with hundreds of system packages, many of which have known vulnerabilities. Most of these packages are not needed to run a Node.js application.

---

### Step 7: Fix the Vulnerability

To fix the pipeline, update the workflow to use the secure Dockerfile instead of the vulnerable one.

Open `.github/workflows/security-scan.yml` and make the following changes in **both** the `scan` job and the `build-and-deploy` job.

**In the `scan` job**, change the build step:

```yaml
# Before:
- name: Build Docker image
  run: docker build -t ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }} -f app/Dockerfile ./app

# After:
- name: Build Docker image
  run: docker build -t ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }} -f docker/Dockerfile.secure .
```

**In the `build-and-deploy` job**, change the build step:

```yaml
# Before:
- name: Build Docker image
  run: |
    docker build -t ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }} -f app/Dockerfile ./app
    docker tag ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }} ${{ env.IMAGE_NAME }}:latest

# After:
- name: Build Docker image
  run: |
    docker build -t ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }} -f docker/Dockerfile.secure .
    docker tag ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }} ${{ env.IMAGE_NAME }}:latest
```

Commit the fix:

```bash
git add .github/workflows/security-scan.yml
git commit -m "Switch to secure Dockerfile to pass Trivy scan"
```

---

### Step 8: Push Again (Pipeline Passes)

```bash
git push origin main
```

Go to the **Actions** tab again. This time:

1. The **Security Scan** job passes — Trivy finds far fewer (or zero) HIGH/CRITICAL vulnerabilities in the Alpine-based image.
2. The **Build & Deploy to EKS** job runs — it pushes the image to DockerHub and deploys the application to your EKS cluster.

---

### Step 9: Verify the Deployment

Once the pipeline completes, verify that your application is running on EKS:

```bash
# Check that the pods are running
kubectl get pods -n secure-app-ns

# Expected output (both pods should be Running and Ready):
# NAME                          READY   STATUS    RESTARTS   AGE
# secure-app-5d8f9b7c4f-abc12   1/1     Running   0          2m
# secure-app-5d8f9b7c4f-def34   1/1     Running   0          2m
```

```bash
# Check the service and get the external URL
kubectl get svc -n secure-app-ns

# Expected output:
# NAME                 TYPE           CLUSTER-IP      EXTERNAL-IP                              PORT(S)        AGE
# secure-app-service   LoadBalancer   10.100.45.123   a1b2c3-1234567890.us-east-1.elb.amazonaws.com   80:31234/TCP   3m
```

Wait a minute or two for the LoadBalancer to provision, then test the endpoints:

```bash
# Replace <EXTERNAL-IP> with the EXTERNAL-IP from the output above
curl http://<EXTERNAL-IP>/health
# {"status":"healthy","timestamp":"2026-03-24T12:00:00.000Z","uptime":120}

curl http://<EXTERNAL-IP>/products
# [{"id":1,"name":"Laptop","price":999.99,"category":"Electronics"}, ...]
```

---

### Step 10: Verify Prometheus Monitoring

If you have Prometheus deployed in your EKS cluster (from a prior lab), the ServiceMonitor will automatically configure scraping.

```bash
# Check that the ServiceMonitor was created
kubectl get servicemonitor -n secure-app-ns

# Expected output:
# NAME                 AGE
# secure-app-monitor   5m
```

Access the metrics endpoint directly to confirm it is working:

```bash
curl http://<EXTERNAL-IP>/metrics
```

You should see Prometheus-format metrics including `http_requests_total` and various default Node.js metrics.

If you have access to the Prometheus UI or Grafana, you can query:

```promql
http_requests_total{app="secure-app"}
```

---

## Cleanup

When you are finished with the lab, remove the deployed resources:

```bash
# Delete all resources in the namespace
kubectl delete namespace secure-app-ns
```

This removes the Deployment, Service, ServiceMonitor, and the namespace itself.

> **Note:** This only removes the Kubernetes resources deployed by this lab. To tear down the underlying EKS cluster and associated infrastructure, follow the cleanup instructions in the [cloud-migration-infra](https://github.com/anmutetech/cloud-migration-infra) repository.

---

## Project Structure

```
container-security-lab/
├── README.md                          # This guide
├── .github/workflows/
│   └── security-scan.yml             # CI/CD pipeline with Trivy scanning
├── app/
│   ├── server.js                     # Express.js application
│   ├── package.json                  # Node.js dependencies
│   └── Dockerfile                    # Default Dockerfile (full node:18 image — triggers Trivy failures)
├── docker/
│   ├── Dockerfile.vulnerable         # Bad example: node:14, root user, no health check
│   └── Dockerfile.secure             # Good example: node:18-alpine, non-root, health check
├── kubernetes/
│   ├── namespace.yaml                # Namespace: secure-app-ns
│   ├── deployment.yaml               # 2-replica deployment with probes and resource limits
│   ├── service.yaml                  # LoadBalancer service (port 80 -> 3000)
│   └── servicemonitor.yaml           # Prometheus ServiceMonitor
└── policies/
    └── trivy-policy.yaml             # Trivy scan policy (fail on HIGH/CRITICAL)
```

---

## What You Learned

- **Container images carry risk.** Even official images from Docker Hub contain OS packages with known vulnerabilities. Scanning is not optional.
- **Alpine images reduce attack surface.** Switching from a full Debian-based image to Alpine eliminates hundreds of unnecessary packages and their associated CVEs.
- **Never run as root.** A non-root user inside a container limits the blast radius if the application is compromised.
- **Security gates belong in CI/CD.** By running Trivy before deployment, you prevent vulnerable images from ever reaching production.
- **Trivy is straightforward to integrate.** A single GitHub Actions step can scan an image and fail the pipeline based on severity thresholds.
- **Health checks and resource limits are part of security.** They prevent denial-of-service scenarios and enable the orchestrator to maintain application availability.
- **Prometheus monitoring provides visibility.** Observability into your application helps detect anomalous behavior that could indicate a security incident.
