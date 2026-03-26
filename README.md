# Container Security Scanning Lab -- VaultPay Payment Gateway

## The Scenario

You have just joined **VaultPay**, a fast-growing payment processing startup that handles credit card transactions for thousands of online merchants. Business is booming -- but the security team just got some bad news.

Last week, an external PCI-DSS auditor performed a routine assessment of VaultPay's infrastructure. The findings were alarming:

- **47 known vulnerabilities (CVEs)** were found in the container images running in production.
- The payment gateway container was **running as the root user**, meaning a single exploit could give an attacker full control of the container -- and potentially the host machine.
- There was **no vulnerability scanning** anywhere in the CI/CD pipeline. Developers could push any image to production without any security checks.
- **No health checks** were configured, so crashed containers went undetected for hours.

The auditor's conclusion: **VaultPay is not PCI-DSS compliant.** The company has **30 days to fix these issues or lose its payment processing license.** Without that license, VaultPay cannot process credit card transactions, and the business shuts down.

As the new DevSecOps engineer, your job is to integrate **Trivy** -- an open-source container vulnerability scanner -- into the CI/CD pipeline so that vulnerable containers are automatically blocked from reaching production. You will also harden the Dockerfile and Kubernetes deployment to meet PCI-DSS requirements.

---

## What You Will Learn

- Why container images contain vulnerabilities and how attackers exploit them
- How to read and interpret a Trivy vulnerability scan report
- The difference between a vulnerable Dockerfile and a secure, PCI-DSS-compliant one
- How to enforce security gates in a GitHub Actions CI/CD pipeline
- How to deploy a scanned, hardened container to Kubernetes on AWS EKS
- How container security maps to real PCI-DSS compliance requirements
- How Prometheus metrics provide observability into your payment gateway

---

## Architecture

This diagram shows the complete flow from code to production. The Trivy scan acts as a security gate -- if it finds vulnerabilities, the image never reaches DockerHub or EKS.

```
                        PASS                          PASS
 GitHub Repo -----> GitHub Actions -----> Trivy Scan -------> DockerHub -----> EKS Cluster
   (push)          (build image)        (security gate)     (push image)    (deploy pods)
                                              |
                                              | FAIL (CVEs found)
                                              v
                                        Pipeline Blocked
                                     (image never deployed)
```

Think of Trivy like airport security. Every container (passenger) must go through the scanner before boarding the plane (production). If the scanner detects something dangerous, that container is stopped right there.

---

## Prerequisites

Before starting this lab, make sure you have the following:

1. **EKS cluster running** -- The `migration-eks-cluster` in `us-east-1` should already be provisioned from the [cloud-migration-infra](https://github.com/anmutetech/cloud-migration-infra) lab.
2. **DockerHub account** -- Sign up at [https://hub.docker.com](https://hub.docker.com) if you do not have one.
3. **kubectl configured** -- Your local `kubectl` should be pointed at the EKS cluster:
   ```bash
   aws eks update-kubeconfig --name migration-eks-cluster --region us-east-1
   ```
4. **AWS CLI** -- Installed and configured with credentials that have EKS access.
5. **Docker** -- Installed locally for building images (optional, the pipeline builds in the cloud).
6. **Git** -- Installed locally.
7. **GitHub account** -- You will fork this repo and configure secrets.

---

## The Problem: Why VaultPay Failed the Audit

Before we fix anything, let's understand what the auditor found. Here is the Dockerfile that VaultPay was using in production:

```dockerfile
FROM node:14        # End-of-life since April 2023 -- no more security patches!
WORKDIR /app
COPY . .            # Copies EVERYTHING -- including secrets and test files
RUN npm install     # Installs dev dependencies too -- unnecessary attack surface
EXPOSE 3000
CMD ["node", "server.js"]
# No USER instruction -- runs as root
# No HEALTHCHECK -- crashes go undetected
```

**What is wrong with this Dockerfile?**

| Problem | Why It Matters | Real-World Analogy |
|---------|---------------|-------------------|
| `node:14` base image | End-of-life. Hundreds of known vulnerabilities that will never be patched. | Driving a car that has been recalled but never repaired. |
| Runs as root | If an attacker breaks in, they have full admin access to the container. | Giving every visitor to your office the master key to every room. |
| `COPY . .` | Copies secrets, tests, and docs into the image. | Putting your diary, tax returns, and passwords in your checked luggage. |
| `npm install` (all deps) | Dev tools in production increase attack surface. | Leaving your construction tools lying around after the building is done. |
| No HEALTHCHECK | Crashed containers sit there broken with no one noticing. | A security guard who fell asleep -- nobody checks if they are still awake. |

---

## Step 1: Fork and Clone

1. Go to this repository on GitHub and click **Fork** to create your own copy.
2. Clone your fork locally:
   ```bash
   git clone https://github.com/<your-github-username>/container-security-lab.git
   cd container-security-lab
   ```

---

## Step 2: Explore the Vulnerable vs Secure Dockerfiles

This is the most important step in the lab. Take time to read both Dockerfiles and understand the differences.

Open the two files side by side:

| Line | Vulnerable (`docker/Dockerfile.vulnerable`) | Secure (`docker/Dockerfile.secure`) |
|------|---------------------------------------------|-------------------------------------|
| Base image | `FROM node:14` (EOL, hundreds of CVEs) | `FROM node:18-alpine` (current LTS, minimal packages) |
| User | Runs as root (default) | `USER vaultpay` (dedicated non-root user) |
| File copy | `COPY . .` (copies everything) | `COPY app/server.js .` (only what is needed) |
| Dependencies | `npm install` (all deps) | `npm install --only=production` (production only) |
| Health check | None | `HEALTHCHECK` with wget to `/health` |
| Cache cleanup | None | `npm cache clean --force` |

**Key insight:** The secure Dockerfile is not more complex -- it is more intentional. Every line has a purpose, and nothing unnecessary is included.

---

## Step 3: Understand the Trivy Security Policy

Open `policies/trivy-policy.yaml`. This file defines the rules for the security gate:

```yaml
severity:
  - CRITICAL
  - HIGH
exit-code: 1
```

This means: "If Trivy finds any CRITICAL or HIGH vulnerabilities, exit with code 1 (failure)." In the CI/CD pipeline, exit code 1 causes the job to fail, which blocks deployment.

**PCI-DSS Requirement 6.3** states that organizations must identify, risk-rank, and address vulnerabilities in a timely manner. This policy file is the automated enforcement of that requirement. Instead of relying on humans to check for vulnerabilities (which is slow and error-prone), the pipeline does it automatically on every push.

---

## Step 4: Configure GitHub Secrets

Your CI/CD pipeline needs credentials to push Docker images and deploy to EKS. In your forked repository on GitHub:

1. Go to **Settings** > **Secrets and variables** > **Actions**
2. Click **New repository secret** and add each of the following:

| Secret Name | Value |
|---|---|
| `DOCKER_USERNAME` | Your DockerHub username |
| `DOCKER_PASSWORD` | Your DockerHub password or access token |
| `AWS_ACCESS_KEY_ID` | Your AWS access key ID |
| `AWS_SECRET_ACCESS_KEY` | Your AWS secret access key |

> **Tip:** For DockerHub, it is recommended to create an Access Token at [https://hub.docker.com/settings/security](https://hub.docker.com/settings/security) instead of using your actual password. This is a security best practice.

---

## Step 5: Update Kubernetes Manifests

Open `kubernetes/deployment.yaml` and replace the placeholder image name with your DockerHub username:

```yaml
# Change this line:
image: <your-dockerhub-username>/vaultpay-gateway:latest

# To this (use YOUR DockerHub username):
image: johndoe/vaultpay-gateway:latest
```

Commit the change:

```bash
git add kubernetes/deployment.yaml
git commit -m "Update deployment image to my DockerHub username"
```

---

## Step 6: Trigger the Pipeline (Watch It Fail!)

This is the "aha moment" of the lab. Push your changes to the `main` branch:

```bash
git push origin main
```

Now go to your repository on GitHub and click the **Actions** tab. You will see the **VaultPay Security Scan & Deploy** workflow running.

**The pipeline will FAIL at the "Security Scan" job.** This is expected and intentional!

The default `app/Dockerfile` uses the full `node:18` image, which is based on Debian and contains hundreds of OS-level packages. Many of these packages have known vulnerabilities. Trivy detects them, finds CRITICAL and HIGH CVEs, and exits with code 1 -- blocking the deployment.

This is exactly what the PCI-DSS auditor wants to see: vulnerable images are automatically prevented from reaching production.

---

## Step 7: Fix the Vulnerability

Now you will play the role of the DevSecOps engineer fixing the issue. Update the workflow to use the secure Dockerfile instead of the vulnerable one.

Open `.github/workflows/security-scan.yml` and change the build command in **both** the `scan` job and the `build-and-deploy` job.

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

## Step 8: Push and Watch It Pass

```bash
git push origin main
```

Go to the **Actions** tab again. This time:

1. The **Security Scan (PCI-DSS Gate)** job passes -- Trivy finds far fewer (or zero) HIGH/CRITICAL vulnerabilities in the Alpine-based image.
2. The **Build & Deploy to EKS** job runs -- it pushes the image to DockerHub and deploys the VaultPay Payment Gateway to your EKS cluster.

Congratulations -- VaultPay's pipeline now has an automated security gate that satisfies PCI-DSS Requirement 6.3!

---

## Step 9: Verify Deployment

Once the pipeline completes, verify that the VaultPay Payment Gateway is running on EKS:

```bash
# Check that the pods are running
kubectl get pods -n vaultpay-ns

# Expected output (both pods should be Running and Ready):
# NAME                                READY   STATUS    RESTARTS   AGE
# vaultpay-gateway-5d8f9b7c4f-abc12   1/1     Running   0          2m
# vaultpay-gateway-5d8f9b7c4f-def34   1/1     Running   0          2m
```

```bash
# Check the service and get the external URL
kubectl get svc -n vaultpay-ns

# Expected output:
# NAME               TYPE           CLUSTER-IP      EXTERNAL-IP                                      PORT(S)        AGE
# vaultpay-service   LoadBalancer   10.100.45.123   a1b2c3-123456.us-east-1.elb.amazonaws.com        80:31234/TCP   3m
```

Wait a minute or two for the LoadBalancer to provision.

---

## Step 10: Explore the Running Application

Replace `<EXTERNAL-IP>` with the EXTERNAL-IP from the previous step.

**Health Check:**

```bash
curl http://<EXTERNAL-IP>/health
```

```json
{
  "service": "VaultPay Payment Gateway",
  "status": "healthy",
  "timestamp": "2026-03-26T12:00:00.000Z",
  "version": "1.0.0"
}
```

**List Transactions:**

```bash
curl http://<EXTERNAL-IP>/api/transactions
```

This returns 10 sample transactions with masked card numbers (e.g., `****-****-****-4532`), merchant names, amounts, and statuses.

**Get a Single Transaction:**

```bash
curl http://<EXTERNAL-IP>/api/transactions/txn-a1b2c3d4
```

**Process a New Transaction:**

```bash
curl -X POST http://<EXTERNAL-IP>/api/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "cardNumber": "4111-1111-1111-1111",
    "merchant": "Test Merchant",
    "amount": 29.99,
    "currency": "USD"
  }'
```

The response includes a unique transaction ID, and the card number is automatically masked for PCI-DSS compliance.

**Prometheus Metrics:**

```bash
curl http://<EXTERNAL-IP>/metrics
```

You will see metrics including `http_requests_total`, `transactions_processed_total`, and `http_request_duration_seconds`.

---

## Understanding Trivy Scan Results

When Trivy scans an image, it produces a table like this:

```
+-----------+----------------+----------+-------------------+--------------+-------------------------------+
|  Library  | Vulnerability  | Severity | Installed Version | Fixed Version|            Title              |
+-----------+----------------+----------+-------------------+--------------+-------------------------------+
| libssl3   | CVE-2024-XXXXX | CRITICAL | 3.0.9-1           | 3.0.13-1     | openssl: buffer overflow      |
| zlib1g    | CVE-2023-XXXXX | HIGH     | 1:1.2.13-1        | 1:1.2.13-2   | zlib: heap corruption         |
| curl      | CVE-2024-XXXXX | MEDIUM   | 7.88.1-1          | 7.88.1-2     | curl: cookie leak             |
+-----------+----------------+----------+-------------------+--------------+-------------------------------+
```

**How to read each column:**

| Column | What It Means | Real-World Analogy |
|--------|--------------|-------------------|
| **Library** | The OS package or software library where the vulnerability lives. | Which part of the car has the defect. |
| **Vulnerability** | The CVE identifier (e.g., CVE-2024-12345). You can look this up at [nvd.nist.gov](https://nvd.nist.gov). | The recall notice number from the manufacturer. |
| **Severity** | How dangerous it is: CRITICAL, HIGH, MEDIUM, or LOW. | CRITICAL = brakes might fail; LOW = paint might chip. |
| **Installed Version** | The version currently in your image. | The part currently in your car. |
| **Fixed Version** | The version that patches the vulnerability. If empty, no fix exists yet. | The replacement part from the manufacturer. |
| **Title** | A short description of what could go wrong. | What the recall notice says the defect might cause. |

**Our policy blocks CRITICAL and HIGH.** That means even if there are MEDIUM and LOW findings, the pipeline still passes. This is a deliberate tradeoff -- blocking everything would make it nearly impossible to deploy, while blocking nothing would leave production exposed.

---

## PCI-DSS Compliance Checklist

This table maps specific PCI-DSS requirements to what you implemented in this lab:

| PCI-DSS Requirement | Description | What You Did |
|---------------------|-------------|-------------|
| **2.2.5** | Remove all unnecessary functionality | Used Alpine base image; installed only production dependencies |
| **3.4** | Render PAN unreadable anywhere it is stored | Card numbers are masked (`****-****-****-4532`) in the API |
| **6.3.1** | Identify security vulnerabilities | Integrated Trivy to scan for CVEs on every push |
| **6.3.2** | Assign risk rankings to vulnerabilities | Trivy categorizes findings as CRITICAL, HIGH, MEDIUM, LOW |
| **6.3.3** | Install patches within defined timeframe | Pipeline blocks deployment until vulnerabilities are fixed |
| **7.1** | Limit access to those who need it | Container runs as non-root user `vaultpay`; capabilities dropped |
| **10.6** | Review logs and security events | Prometheus metrics and health checks provide observability |
| **11.3** | Perform vulnerability scans | Trivy runs automatically in CI/CD on every code change |

---

## Cleanup

When you are finished with the lab, remove the deployed resources:

```bash
# Delete all resources in the namespace
kubectl delete namespace vaultpay-ns
```

This removes the Deployment, Service, ServiceMonitor, and the namespace itself.

> **Note:** This only removes the Kubernetes resources deployed by this lab. To tear down the underlying EKS cluster and associated infrastructure, follow the cleanup instructions in the [cloud-migration-infra](https://github.com/anmutetech/cloud-migration-infra) repository.

---

## Project Structure

```
container-security-lab/
├── README.md                              # This guide
├── .gitignore                             # Files to exclude from version control
├── .github/workflows/
│   └── security-scan.yml                 # CI/CD pipeline with Trivy scanning
├── app/
│   ├── server.js                         # VaultPay Payment Gateway API (Express.js)
│   ├── package.json                      # Node.js dependencies
│   └── Dockerfile                        # Default Dockerfile (triggers Trivy failures)
├── docker/
│   ├── Dockerfile.vulnerable             # Bad example: node:14, root user, no health check
│   └── Dockerfile.secure                 # Good example: node:18-alpine, non-root, health check
├── kubernetes/
│   ├── namespace.yaml                    # Namespace: vaultpay-ns (PCI-DSS labeled)
│   ├── deployment.yaml                   # 2-replica deployment with security context
│   ├── service.yaml                      # LoadBalancer service (port 80 -> 3000)
│   └── servicemonitor.yaml               # Prometheus ServiceMonitor (scrapes /metrics)
└── policies/
    └── trivy-policy.yaml                 # Trivy scan policy (fail on HIGH/CRITICAL)
```

---

## What's Next?

Now that you have secured VaultPay's container pipeline, continue building your cloud security skills with these related labs:

- **[cloud-migration-infra](https://github.com/anmutetech/cloud-migration-infra)** -- Infrastructure as Code with Terraform for EKS
- **[monitoring-stack](https://github.com/anmutetech/monitoring-stack)** -- Set up Prometheus and Grafana for full observability
- **[gitops-lab](https://github.com/anmutetech/gitops-lab)** -- Implement GitOps with ArgoCD for automated Kubernetes deployments
